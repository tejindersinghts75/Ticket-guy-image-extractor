// utils/phoneHelper.js
/**
 * Phone Helper Utility
 * Finds phone number across different data structures in your system
 */

class PhoneHelper {
  /**
   * Find phone number in ticket data
   * Checks all possible locations where phone might be stored
   * @param {Object} ticketData - Firestore ticket document
   * @returns {string|null} - Phone number or null if not found
   */
  static findPhoneNumber(ticketData) {
    if (!ticketData) {
      return null;
    }

    // Check all possible locations in order of priority
    const possiblePaths = [
      // 1. Root level (preferred - from missing form)
      () => ticketData.phoneNumber,
      
      // 2. Extracted data root level
      () => ticketData.extractedData?.phone_number,
      
      // 3. Nested in violator information
      () => ticketData.extractedData?.violator_information?.phone,
      
      // 4. From manual form submissions
      () => ticketData.formData?.phone,
      () => ticketData.formData?.phone_number,
      () => ticketData.formData?.mobileno,
      
      // 5. From no-ticket form
      () => ticketData.phone,
      
      // 6. Any other potential locations
      () => ticketData.contact?.phone,
      () => ticketData.user?.phone
    ];

    for (const getPhone of possiblePaths) {
      const phone = getPhone();
      if (this.isValidPhone(phone)) {
        return phone;
      }
    }

    return null;
  }

  /**
   * Check if phone number is valid
   * @param {string} phone - Phone number to validate
   * @returns {boolean} - True if valid
   */
  static isValidPhone(phone) {
    if (!phone || typeof phone !== 'string') {
      return false;
    }

    // Clean the phone number
    const cleaned = phone.replace(/\D/g, '');
    
    // US phone numbers: 10 digits (without country code)
    // International: at least 5 digits
    return cleaned.length >= 10;
  }

  /**
   * Format phone number for SMS (add +1 for US numbers)
   * @param {string} phone - Raw phone number
   * @returns {string} - Formatted phone number
   */
  static formatForSms(phone) {
    if (!phone) {
      return null;
    }

    // Remove all non-digits
    const digits = phone.replace(/\D/g, '');
    
    // If it's a US number (10 digits) and doesn't start with country code
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    
    // If it already has country code (11 digits starting with 1)
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    
    // For other lengths, assume it has country code
    return `+${digits}`;
  }

  /**
   * Check if SMS should be sent for this ticket
   * @param {Object} ticketData - Firestore ticket document
   * @returns {Object} - { shouldSend: boolean, phoneNumber: string|null, reason: string }
   */
  static shouldSendSms(ticketData) {
    // Check if SMS is opted-in
    const isOptedIn = ticketData.smsOptIn === true;
    
    // Find phone number
    const rawPhone = this.findPhoneNumber(ticketData);
    const formattedPhone = rawPhone ? this.formatForSms(rawPhone) : null;
    
    // Decision logic
    if (!isOptedIn) {
      return {
        shouldSend: false,
        phoneNumber: formattedPhone,
        reason: 'User not opted-in for SMS'
      };
    }
    
    if (!formattedPhone) {
      return {
        shouldSend: false,
        phoneNumber: null,
        reason: 'No valid phone number found'
      };
    }
    
    return {
      shouldSend: true,
      phoneNumber: formattedPhone,
      reason: 'Ready to send SMS'
    };
  }

  /**
   * Extract SMS opt-in status from ticket data
   * @param {Object} ticketData - Firestore ticket document
   * @returns {boolean} - True if opted in
   */
  static getSmsOptInStatus(ticketData) {
    // Check all possible opt-in field names
    const possibleOptInFields = [
      ticketData.smsOptIn,
      ticketData.receiveSms,
      ticketData.smsNotifications,
      ticketData.textOptIn,
      ticketData.allowSms
    ];
    
    // Return true if any field is explicitly true
    return possibleOptInFields.some(field => field === true);
  }
}

module.exports = PhoneHelper;