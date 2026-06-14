/**
 * DoodhWala Auth Service
 * Handles Supabase Phone OTP authentication via direct REST API calls.
 * No @supabase/supabase-js dependency — consistent with the existing sync.js approach.
 */
import { dbService } from './db';

class AuthService {
  /**
   * Check whether a valid session exists in AppSettings.
   * A session is considered valid if both milkman_uuid and auth_token are saved.
   * @returns {Promise<boolean>}
   */
  async isLoggedIn() {
    try {
      // Wait for DB to be ready
      while (!dbService.initialized) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const settings = await dbService.getAppSettings();
      return !!(settings && settings.milkman_uuid && settings.auth_token);
    } catch (err) {
      console.error('AuthService.isLoggedIn error:', err);
      return false;
    }
  }

  /**
   * Request an OTP to be sent to the given phone number via Supabase.
   * @param {string} supabaseUrl - The Supabase project URL from AppSettings
   * @param {string} supabaseAnonKey - The anon public key from AppSettings
   * @param {string} phone - Phone number in E.164 format, e.g. +919876543210
   * @returns {Promise<void>} - Resolves on success, throws on failure
   */
  async requestOtp(supabaseUrl, supabaseAnonKey, phone) {
    const url = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/otp`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ phone }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.msg || data.error_description || `OTP request failed (status ${response.status})`);
    }
  }

  /**
   * Verify the OTP token for a given phone number.
   * Returns the Supabase access_token and user UUID on success.
   * @param {string} supabaseUrl
   * @param {string} supabaseAnonKey
   * @param {string} phone - E.164 format
   * @param {string} token - The 6-digit OTP code
   * @returns {Promise<{ accessToken: string, userId: string }>}
   */
  async verifyOtp(supabaseUrl, supabaseAnonKey, phone, token) {
    const url = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/verify`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ phone, token, type: 'sms' }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.msg || data.error_description || `OTP verification failed (status ${response.status})`);
    }

    if (!data.access_token || !data.user?.id) {
      throw new Error('Invalid response from Supabase: missing access_token or user ID.');
    }

    return {
      accessToken: data.access_token,
      userId: data.user.id,
    };
  }

  /**
   * Persist the auth session (UUID + JWT token) to AppSettings.
   * @param {string} milkmanUuid - The Supabase auth.users.id (UUID)
   * @param {string} authToken - The JWT access_token
   * @param {string} phone - The phone number used to log in
   */
  async saveSession(milkmanUuid, authToken, phone) {
    await dbService.run(
      `UPDATE AppSettings SET 
        milkman_uuid = ?, 
        auth_token = ?, 
        phone_number = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE setting_id = 1;`,
      [milkmanUuid, authToken, phone]
    );
  }

  /**
   * Clear the session from AppSettings (Logout).
   */
  async logout() {
    await dbService.run(
      `UPDATE AppSettings SET 
        milkman_uuid = NULL, 
        auth_token = NULL
       WHERE setting_id = 1;`,
      []
    );
  }

  /**
   * Check if BusinessProfile is in "first-time setup" state.
   * We detect this by checking if the profile is empty or has the placeholder UUID.
   * @returns {Promise<boolean>}
   */
  async isFirstTimeSetup() {
    try {
      const res = await dbService.query('SELECT * FROM BusinessProfile LIMIT 1;');
      if (!res.values || res.values.length === 0) return true;
      const profile = res.values[0];
      // Placeholder UUID from seed data = not yet set up by real user
      if (profile.business_uuid === 'bus-doodh-uuid') return true;
      // Check required fields are populated
      if (!profile.business_name || !profile.milkman_name || !profile.upi_id) return true;
      return false;
    } catch (err) {
      console.error('AuthService.isFirstTimeSetup error:', err);
      return true;
    }
  }

  /**
   * Save the BusinessProfile after first-time setup.
   * Replaces placeholder seed data with real user data.
   * @param {object} profile
   * @param {string} profile.businessName
   * @param {string} profile.milkmanName
   * @param {string} profile.phone
   * @param {string} profile.upiId
   * @param {string} profile.address
   */
  async saveBusinessProfile(profile) {
    const existingRes = await dbService.query('SELECT business_id, business_uuid FROM BusinessProfile LIMIT 1;');

    if (existingRes.values && existingRes.values.length > 0) {
      const existing = existingRes.values[0];
      const realUuid = existing.business_uuid === 'bus-doodh-uuid'
        ? `biz-${Date.now()}`
        : existing.business_uuid;

      await dbService.run(
        `UPDATE BusinessProfile SET
          business_uuid = ?,
          business_name = ?,
          milkman_name = ?,
          phone_number = ?,
          upi_id = ?,
          address = ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE business_id = ?;`,
        [
          realUuid,
          profile.businessName.trim(),
          profile.milkmanName.trim(),
          profile.phone.trim(),
          profile.upiId.trim(),
          profile.address ? profile.address.trim() : '',
          existing.business_id,
        ]
      );
    } else {
      // No profile row yet — insert fresh
      await dbService.run(
        `INSERT INTO BusinessProfile (business_uuid, business_name, milkman_name, phone_number, upi_id, address)
         VALUES (?, ?, ?, ?, ?, ?);`,
        [
          `biz-${Date.now()}`,
          profile.businessName.trim(),
          profile.milkmanName.trim(),
          profile.phone.trim(),
          profile.upiId.trim(),
          profile.address ? profile.address.trim() : '',
        ]
      );
    }
  }
}

export const authService = new AuthService();
