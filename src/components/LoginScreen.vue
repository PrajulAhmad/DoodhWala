<script setup>
import { ref, computed, onUnmounted } from 'vue';
import { authService } from '../services/auth';
import { dbService } from '../services/db';
import { config } from '../config';

const emit = defineEmits(['logged-in']);

// ─── Step state ────────────────────────────────────────────────────────────
// 'phone' | 'otp' | 'setup'
const step = ref('phone');

// ─── Supabase config ───────────────────────────────────
const supabaseUrl = ref('');
const supabaseAnonKey = ref('');
const configLoaded = ref(false);
const configError = ref('');

// Load Supabase config from config.js on mount
const loadConfig = () => {
  supabaseUrl.value = config.supabaseUrl;
  supabaseAnonKey.value = config.supabaseAnonKey;
  configLoaded.value = true;

  if (!supabaseUrl.value || !supabaseAnonKey.value) {
    configError.value = 'Supabase URL and Anon Key are not configured in environment variables. Please contact the developer.';
  }
};
loadConfig();

// ─── Phone step ─────────────────────────────────────────────────────────
const phoneRaw = ref(''); // user types 10-digit number; we prepend +91
const phoneFormatted = computed(() => {
  const digits = phoneRaw.value.replace(/\D/g, '').slice(0, 10);
  return digits ? `+91${digits}` : '';
});
const phoneError = ref('');
const otpSending = ref(false);

const sendOtp = async () => {
  phoneError.value = '';
  const digits = phoneRaw.value.replace(/\D/g, '');
  if (digits.length !== 10) {
    phoneError.value = 'Please enter a valid 10-digit mobile number.';
    return;
  }

  if (!supabaseUrl.value || !supabaseAnonKey.value) {
    phoneError.value = 'Supabase is not configured. Please verify environment variables.';
    return;
  }

  otpSending.value = true;
  try {
    await authService.requestOtp(phoneFormatted.value);
    step.value = 'otp';
    startResendTimer();
  } catch (err) {
    phoneError.value = err.message || 'Failed to send OTP. Check your internet connection.';
  } finally {
    otpSending.value = false;
  }
};

// ─── OTP step ───────────────────────────────────────────────────────────
const otpCode = ref('');
const otpError = ref('');
const otpVerifying = ref(false);

// Resend cooldown timer
const resendCooldown = ref(0);
let cooldownTimer = null;

const startResendTimer = () => {
  resendCooldown.value = 30;
  clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    resendCooldown.value--;
    if (resendCooldown.value <= 0) {
      clearInterval(cooldownTimer);
    }
  }, 1000);
};

onUnmounted(() => clearInterval(cooldownTimer));

const verifyOtp = async () => {
  otpError.value = '';
  const code = otpCode.value.replace(/\D/g, '');
  if (code.length !== 6) {
    otpError.value = 'Please enter the 6-digit OTP code.';
    return;
  }

  otpVerifying.value = true;
  try {
    const { accessToken, userId } = await authService.verifyOtp(
      phoneFormatted.value,
      code
    );

    // Save session to AppSettings
    await authService.saveSession(userId, accessToken, phoneFormatted.value);

    // Check if first-time setup is needed
    const needsSetup = await authService.isFirstTimeSetup();
    if (needsSetup) {
      setupPhone.value = phoneFormatted.value;
      step.value = 'setup';
    } else {
      emit('logged-in');
    }
  } catch (err) {
    otpError.value = err.message || 'Invalid OTP. Please try again.';
  } finally {
    otpVerifying.value = false;
  }
};

const resendOtp = async () => {
  if (resendCooldown.value > 0) return;
  otpCode.value = '';
  otpError.value = '';
  await sendOtp();
};

const backToPhone = () => {
  step.value = 'phone';
  otpCode.value = '';
  otpError.value = '';
};

// ─── First-time setup step ──────────────────────────────────────────────
const setupBusinessName = ref('');
const setupMilkmanName = ref('');
const setupPhone = ref('');
const setupUpiId = ref('');
const setupAddress = ref('');
const setupError = ref('');
const setupSaving = ref(false);

const saveSetup = async () => {
  setupError.value = '';
  if (!setupBusinessName.value.trim()) { setupError.value = 'Business name is required.'; return; }
  if (!setupMilkmanName.value.trim()) { setupError.value = 'Your name is required.'; return; }
  if (!setupUpiId.value.trim()) { setupError.value = 'UPI ID is required for generating invoices.'; return; }

  setupSaving.value = true;
  try {
    await authService.saveBusinessProfile({
      businessName: setupBusinessName.value,
      milkmanName: setupMilkmanName.value,
      phone: setupPhone.value,
      upiId: setupUpiId.value,
      address: setupAddress.value,
    });
    emit('logged-in');
  } catch (err) {
    setupError.value = err.message || 'Failed to save profile. Please try again.';
  } finally {
    setupSaving.value = false;
  }
};

// ─── Dev bypass ─────────────────────────────────────────────────────────
const isDev = import.meta.env.DEV;

const devBypass = async () => {
  try {
    // In dev mode, skip auth and go directly to main app
    // Seeds a dev session UUID so the app considers itself logged in
    await dbService.run(
      `UPDATE AppSettings SET milkman_uuid = ?, auth_token = ?, phone_number = ? WHERE setting_id = 1;`,
      ['dev-milkman-uuid', 'dev-bypass-token', '+910000000000']
    );
    emit('logged-in');
  } catch (err) {
    console.error("Dev bypass failed:", err);
    alert("Dev bypass failed: " + err.message);
  }
};

</script>

<template>
  <div class="login-screen">
    <!-- Background decorative elements -->
    <div class="login-bg-blob login-bg-blob-1"></div>
    <div class="login-bg-blob login-bg-blob-2"></div>

    <div class="login-container">

      <!-- ── STEP 1: PHONE ENTRY ─────────────────────────────────────── -->
      <div v-if="step === 'phone'" class="login-card">
        <!-- Logo -->
        <div class="login-logo-section">
          <div class="login-logo-circle">
            <span class="login-logo-emoji">🥛</span>
          </div>
          <h1 class="login-title">DoodhWala</h1>
          <p class="login-subtitle">Your digital Khata. Always offline-ready.</p>
        </div>

        <!-- Phone input -->
        <div class="login-form">
          <p v-if="configError" class="login-error">{{ configError }}</p>
          <label class="login-label">Mobile Number</label>
          <div class="login-phone-row">
            <span class="login-phone-prefix">+91</span>
            <input
              id="phone-input"
              v-model="phoneRaw"
              type="tel"
              inputmode="numeric"
              maxlength="10"
              placeholder="9876543210"
              class="login-phone-input"
              @keyup.enter="sendOtp"
            />
          </div>
          <p v-if="phoneError" class="login-error">{{ phoneError }}</p>

          <button
            id="send-otp-btn"
            @click="sendOtp"
            :disabled="otpSending || !configLoaded || !!configError"
            class="login-btn-primary"
          >
            <span v-if="otpSending" class="material-symbols-outlined login-spin">sync</span>
            <span v-else class="material-symbols-outlined">sms</span>
            {{ otpSending ? 'Sending OTP…' : 'Send OTP' }}
          </button>
        </div>

        <!-- Dev Mode bypass -->
        <div v-if="isDev" class="login-dev-bypass">
          <p class="login-dev-label">⚙️ Dev Mode</p>
          <button id="dev-bypass-btn" @click="devBypass" class="login-btn-dev">
            Skip Login (Dev Bypass)
          </button>
        </div>
      </div>

      <!-- ── STEP 2: OTP VERIFICATION ───────────────────────────────── -->
      <div v-else-if="step === 'otp'" class="login-card">
        <div class="login-logo-section">
          <div class="login-logo-circle">
            <span class="login-logo-emoji">📱</span>
          </div>
          <h1 class="login-title">Enter OTP</h1>
          <p class="login-subtitle">
            Code sent to <strong>{{ phoneFormatted }}</strong>
          </p>
        </div>

        <div class="login-form">
          <label class="login-label">6-Digit Verification Code</label>
          <input
            id="otp-input"
            v-model="otpCode"
            type="tel"
            inputmode="numeric"
            maxlength="6"
            placeholder="• • • • • •"
            class="login-otp-input"
            @keyup.enter="verifyOtp"
          />
          <p v-if="otpError" class="login-error">{{ otpError }}</p>

          <button
            id="verify-otp-btn"
            @click="verifyOtp"
            :disabled="otpVerifying"
            class="login-btn-primary"
          >
            <span v-if="otpVerifying" class="material-symbols-outlined login-spin">sync</span>
            <span v-else class="material-symbols-outlined">verified</span>
            {{ otpVerifying ? 'Verifying…' : 'Verify OTP' }}
          </button>

          <div class="login-otp-actions">
            <button
              @click="resendOtp"
              :disabled="resendCooldown > 0"
              class="login-link-btn"
            >
              Resend OTP{{ resendCooldown > 0 ? ` (${resendCooldown}s)` : '' }}
            </button>
            <span class="login-divider">·</span>
            <button @click="backToPhone" class="login-link-btn">
              Change Number
            </button>
          </div>
        </div>
      </div>

      <!-- ── STEP 3: FIRST-TIME BUSINESS SETUP ──────────────────────── -->
      <div v-else-if="step === 'setup'" class="login-card login-card-setup">
        <div class="login-logo-section">
          <div class="login-logo-circle login-logo-circle-green">
            <span class="login-logo-emoji">🏪</span>
          </div>
          <h1 class="login-title">Set Up Your Business</h1>
          <p class="login-subtitle">This information appears on every invoice you send.</p>
        </div>

        <div class="login-form">
          <div class="login-field">
            <label class="login-label">Business / Dairy Name <span class="login-required">*</span></label>
            <input
              id="setup-business-name"
              v-model="setupBusinessName"
              type="text"
              placeholder="e.g. Krishna Dairy"
              class="login-input"
            />
          </div>

          <div class="login-field">
            <label class="login-label">Your Name <span class="login-required">*</span></label>
            <input
              id="setup-milkman-name"
              v-model="setupMilkmanName"
              type="text"
              placeholder="e.g. Ramesh Sharma"
              class="login-input"
            />
          </div>

          <div class="login-field">
            <label class="login-label">Mobile Number</label>
            <input
              type="text"
              :value="setupPhone"
              readonly
              class="login-input login-input-readonly"
            />
          </div>

          <div class="login-field">
            <label class="login-label">UPI ID <span class="login-required">*</span></label>
            <input
              id="setup-upi-id"
              v-model="setupUpiId"
              type="text"
              placeholder="e.g. kdairy@okaxis"
              class="login-input"
            />
            <p class="login-field-hint">Customers will see this on their invoice for payment.</p>
          </div>

          <div class="login-field">
            <label class="login-label">Business Address <span class="login-optional">(Optional)</span></label>
            <textarea
              id="setup-address"
              v-model="setupAddress"
              rows="2"
              placeholder="e.g. Sector 4, Dwarka, New Delhi"
              class="login-textarea"
            ></textarea>
          </div>

          <p v-if="setupError" class="login-error">{{ setupError }}</p>

          <button
            id="setup-submit-btn"
            @click="saveSetup"
            :disabled="setupSaving"
            class="login-btn-primary login-btn-green"
          >
            <span v-if="setupSaving" class="material-symbols-outlined login-spin">sync</span>
            <span v-else class="material-symbols-outlined">rocket_launch</span>
            {{ setupSaving ? 'Saving…' : 'Get Started' }}
          </button>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* ── Layout ──────────────────────────────────────────────────────── */
.login-screen {
  min-height: 100vh;
  background: linear-gradient(145deg, #f0f4ff 0%, #e8f5e9 50%, #f3e5f5 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  position: relative;
  overflow: hidden;
}

.login-bg-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.35;
  pointer-events: none;
}

.login-bg-blob-1 {
  width: 300px;
  height: 300px;
  background: #4A90D9;
  top: -80px;
  left: -80px;
}

.login-bg-blob-2 {
  width: 250px;
  height: 250px;
  background: #4CAF50;
  bottom: -60px;
  right: -60px;
}

.login-container {
  width: 100%;
  max-width: 400px;
  z-index: 1;
}

/* ── Card ────────────────────────────────────────────────────────── */
.login-card {
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 24px;
  padding: 32px 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06);
  animation: login-slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.login-card-setup {
  padding-bottom: 40px;
}

@keyframes login-slide-up {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── Logo section ────────────────────────────────────────────────── */
.login-logo-section {
  text-align: center;
  margin-bottom: 28px;
}

.login-logo-circle {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: linear-gradient(135deg, #1565C0 0%, #42A5F5 100%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  box-shadow: 0 4px 16px rgba(21, 101, 192, 0.35);
}

.login-logo-circle-green {
  background: linear-gradient(135deg, #2E7D32 0%, #66BB6A 100%);
  box-shadow: 0 4px 16px rgba(46, 125, 50, 0.35);
}

.login-logo-emoji {
  font-size: 32px;
  line-height: 1;
}

.login-title {
  font-size: 22px;
  font-weight: 800;
  color: #1a1a2e;
  margin: 0 0 4px;
  letter-spacing: -0.3px;
}

.login-subtitle {
  font-size: 13px;
  color: #5a6a7a;
  margin: 0;
  line-height: 1.4;
}

/* ── Form ────────────────────────────────────────────────────────── */
.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.login-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.login-label {
  font-size: 12px;
  font-weight: 700;
  color: #374151;
  letter-spacing: 0.2px;
}

.login-required { color: #ef4444; }
.login-optional { color: #9ca3af; font-weight: 400; }

.login-field-hint {
  font-size: 11px;
  color: #6b7280;
  margin: 2px 0 0;
}

/* ── Phone row ───────────────────────────────────────────────────── */
.login-phone-row {
  display: flex;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
  transition: border-color 0.2s;
  background: white;
}
.login-phone-row:focus-within {
  border-color: #1565C0;
  box-shadow: 0 0 0 3px rgba(21, 101, 192, 0.12);
}

.login-phone-prefix {
  padding: 12px 12px 12px 14px;
  background: #f1f5f9;
  font-size: 15px;
  font-weight: 700;
  color: #374151;
  border-right: 2px solid #e5e7eb;
  user-select: none;
}

.login-phone-input {
  flex: 1;
  border: none;
  outline: none;
  padding: 12px 14px;
  font-size: 18px;
  font-weight: 600;
  color: #111827;
  background: transparent;
  letter-spacing: 1px;
}

/* ── OTP input ───────────────────────────────────────────────────── */
.login-otp-input {
  width: 100%;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  padding: 14px 16px;
  font-size: 28px;
  font-weight: 800;
  color: #111827;
  text-align: center;
  letter-spacing: 8px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  background: white;
  box-sizing: border-box;
}
.login-otp-input:focus {
  border-color: #1565C0;
  box-shadow: 0 0 0 3px rgba(21, 101, 192, 0.12);
}

/* ── Standard inputs ─────────────────────────────────────────────── */
.login-input {
  width: 100%;
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  padding: 11px 14px;
  font-size: 14px;
  color: #111827;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  background: white;
  box-sizing: border-box;
}
.login-input:focus {
  border-color: #1565C0;
  box-shadow: 0 0 0 3px rgba(21, 101, 192, 0.12);
}
.login-input-readonly {
  background: #f9fafb;
  color: #6b7280;
  cursor: default;
}

.login-textarea {
  width: 100%;
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  padding: 11px 14px;
  font-size: 14px;
  color: #111827;
  outline: none;
  resize: none;
  transition: border-color 0.2s;
  background: white;
  box-sizing: border-box;
  font-family: inherit;
}
.login-textarea:focus {
  border-color: #1565C0;
  box-shadow: 0 0 0 3px rgba(21, 101, 192, 0.12);
}

/* ── Buttons ─────────────────────────────────────────────────────── */
.login-btn-primary {
  width: 100%;
  padding: 14px 16px;
  background: linear-gradient(135deg, #1565C0 0%, #1976D2 100%);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s;
  box-shadow: 0 4px 12px rgba(21, 101, 192, 0.3);
  margin-top: 4px;
}
.login-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #0d47a1 0%, #1565C0 100%);
  box-shadow: 0 6px 16px rgba(21, 101, 192, 0.4);
  transform: translateY(-1px);
}
.login-btn-primary:active:not(:disabled) {
  transform: translateY(0) scale(0.98);
}
.login-btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.login-btn-green {
  background: linear-gradient(135deg, #2E7D32 0%, #43A047 100%);
  box-shadow: 0 4px 12px rgba(46, 125, 50, 0.3);
}
.login-btn-green:hover:not(:disabled) {
  background: linear-gradient(135deg, #1B5E20 0%, #2E7D32 100%);
  box-shadow: 0 6px 16px rgba(46, 125, 50, 0.4);
}

.login-btn-secondary {
  width: 100%;
  padding: 10px 16px;
  background: white;
  color: #1565C0;
  border: 2px solid #1565C0;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}
.login-btn-secondary:hover:not(:disabled) {
  background: #e3f2fd;
}
.login-btn-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ── OTP actions row ─────────────────────────────────────────────── */
.login-otp-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.login-link-btn {
  background: none;
  border: none;
  color: #1565C0;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px;
  text-decoration: underline;
  text-underline-offset: 2px;
  transition: opacity 0.2s;
}
.login-link-btn:disabled {
  color: #9ca3af;
  cursor: default;
  text-decoration: none;
}

.login-divider {
  color: #d1d5db;
  font-size: 16px;
}

/* ── Error & success ─────────────────────────────────────────────── */
.login-error {
  font-size: 12px;
  color: #dc2626;
  background: #fef2f2;
  border: 1px solid #fca5a5;
  border-radius: 8px;
  padding: 8px 10px;
  margin: 0;
}

.login-success {
  font-size: 12px;
  color: #15803d;
  background: #f0fdf4;
  border: 1px solid #86efac;
  border-radius: 8px;
  padding: 8px 10px;
  margin: 0;
}

/* ── Config section ──────────────────────────────────────────────── */
.login-config-section {
  margin-top: 4px;
  border-top: 1px solid #f1f5f9;
  padding-top: 12px;
}

.login-config-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 0;
  transition: color 0.2s;
}
.login-config-toggle:hover {
  color: #374151;
}
.login-config-toggle .rotate-180 {
  transform: rotate(180deg);
}

.login-config-panel {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.login-config-hint {
  font-size: 11px;
  color: #6b7280;
  margin: 0;
  line-height: 1.5;
}

.login-config-input {
  width: 100%;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 12px;
  color: #111827;
  outline: none;
  transition: border-color 0.2s;
  background: white;
  box-sizing: border-box;
}
.login-config-input:focus {
  border-color: #1565C0;
}

/* ── Dev bypass ──────────────────────────────────────────────────── */
.login-dev-bypass {
  margin-top: 16px;
  border-top: 1px dashed #fca5a5;
  padding-top: 12px;
  text-align: center;
}

.login-dev-label {
  font-size: 11px;
  color: #dc2626;
  font-weight: 700;
  margin: 0 0 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.login-btn-dev {
  background: #fef2f2;
  border: 1.5px dashed #fca5a5;
  color: #dc2626;
  font-size: 12px;
  font-weight: 700;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
  width: 100%;
}
.login-btn-dev:hover {
  background: #fee2e2;
}

/* ── Spinner ─────────────────────────────────────────────────────── */
.login-spin {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
</style>
