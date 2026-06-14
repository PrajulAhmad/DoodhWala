import { LocalNotifications } from '@capacitor/local-notifications';

const getLastDayOfMonth = (date) => {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return d.getDate();
};

export const notificationService = {
  // Initialize and check/request permissions
  async initialize() {
    try {
      const status = await LocalNotifications.checkPermissions();
      if (status.display !== 'granted') {
        await LocalNotifications.requestPermissions();
      }
      
      // Setup month-end billing reminder
      await this.scheduleMonthEndBillingNotification();
    } catch (err) {
      console.error("Failed to initialize local notifications:", err);
    }
  },

  // Schedule month-end billing reminder
  async scheduleMonthEndBillingNotification() {
    try {
      // Cancel existing MONTH_END_BILLING reminder
      await LocalNotifications.cancel({
        notifications: [{ id: 101 }]
      });

      const now = new Date();
      let target = new Date(now.getFullYear(), now.getMonth(), getLastDayOfMonth(now), 8, 0, 0);
      
      // If we are already past 8 AM on the last day, schedule for the next month
      if (now.getTime() > target.getTime()) {
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        target = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), getLastDayOfMonth(nextMonth), 8, 0, 0);
      }

      await LocalNotifications.schedule({
        notifications: [
          {
            title: "Month-End Billing Reminder",
            body: "The billing period has ended. Compile and share customer invoices now.",
            id: 101,
            schedule: { at: target }
          }
        ]
      });
      console.log(`Month-end billing notification scheduled for: ${target}`);
    } catch (err) {
      console.error("Failed to schedule month-end billing notification:", err);
    }
  },

  // Immediate notification triggered when sync fails repeatedly
  async triggerSyncFailureNotification() {
    try {
      const status = await LocalNotifications.checkPermissions();
      if (status.display !== 'granted') return;

      await LocalNotifications.schedule({
        notifications: [
          {
            title: "Sync Failure Alert",
            body: "DoodhWala background sync is repeatedly failing. Check your internet connection or sync configuration.",
            id: 102,
            schedule: { at: new Date(Date.now() + 1000) } // Fire in 1 second
          }
        ]
      });
      console.log("Sync failure notification fired.");
    } catch (err) {
      console.error("Failed to trigger sync failure notification:", err);
    }
  }
};
