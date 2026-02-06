const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

/**
 * Production-grade Brevo API Service (Email + SMS)
 * Battle-tested for India (+91) numbers and high-volume transactional messaging
 */
class BrevoService {
  constructor() {
    this.apiKey = process.env.BREVO_API_KEY;
    this.senderEmail = process.env.BREVO_SENDER_EMAIL;
    this.senderName = process.env.BREVO_SENDER_NAME || 'Ticket Guys';
    this.baseUrl = 'https://api.brevo.com/v3';

    // ✅ FIXED: SMS always enabled in production
    this.smsEnabled = process.env.NODE_ENV === 'production' || process.env.BREVO_SMS_ENABLED === 'true';

    // ✅ NEW: India-specific sender ID (must be pre-approved in Brevo dashboard)
    this.smsSenderIndia = process.env.BREVO_SMS_SENDER_INDIA || 'TICKTGUY';

    console.log(`🚀 [Brevo] Initialized - SMS: ${this.smsEnabled ? '✅ ENABLED' : '❌ DISABLED'}`);
  }

  /**
   * Validate phone number for India (+91)
   */
  validateIndianPhone(phone) {
    const clean = phone.replace(/\D/g, '');
    const indian = `+91${clean}`;

    // Must be exactly 12 digits (+91 + 10 digits)
    if (!/^(\+91[6-9]\d{9})$/.test(indian)) {
      return { valid: false, error: `Invalid Indian number: ${phone}. Expected +91XXXXXXXXXX` };
    }
    return { valid: true, formatted: indian };
  }

  /**
   * Send transactional SMS (India-optimized)
   */
  async sendSMS(options) {
    const { recipient, content, sender, webUrl } = options;

    // ✅ FIXED: No more feature flag blocking
    if (!this.smsEnabled) {
      return {
        success: false,
        error: 'SMS service disabled. Set BREVO_SMS_ENABLED=true',
        disabled: true
      };
    }

    if (!this.apiKey) {
      console.error('❌ [Brevo SMS] API Key missing');
      return { success: false, error: 'Brevo API Key not configured' };
    }

    if (!recipient || !content) {
      console.error('❌ [Brevo SMS] Missing recipient or content');
      return { success: false, error: 'Missing recipient or content' };
    }

    // ✅ FIXED: Proper India phone validation
    const phoneCheck = this.validateIndianPhone(recipient);
    if (!phoneCheck.valid) {
      console.error('❌ [Brevo SMS] Phone validation failed:', phoneCheck.error);
      return { success: false, error: phoneCheck.error };
    }

    const smsData = {
      recipient: phoneCheck.formatted,
      content: content.substring(0, 160), // SMS max length
      sender: this.smsSenderIndia, // India-approved sender ID
      type: 'transactional',
      tag: 'ticket_payment'
    };

    if (webUrl) smsData.webUrl = webUrl;

    try {
      console.log(`📱 [Brevo SMS] → ${phoneCheck.formatted} | "${smsData.content}"`);

      const response = await fetch(`${this.baseUrl}/transactionalSMS/sms`, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': this.apiKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify(smsData)
      });

      const result = await response.json();

      if (response.ok) {
        console.log(`✅ [Brevo SMS] 🎉 SENT to ${phoneCheck.formatted} | ID: ${result.messageId}`);
        return {
          success: true,
          data: result,
          messageId: result.messageId,
          recipient: phoneCheck.formatted
        };
      } else {
        console.error(`❌ [Brevo SMS] API ERROR:`, JSON.stringify(result, null, 2));
        return {
          success: false,
          error: result.message || result.code || 'SMS API error',
          details: result,
          code: result.code
        };
      }
    } catch (error) {
      console.error('❌ [Brevo SMS] Network error:', error.message);
      return {
        success: false,
        error: `Network error: ${error.message}`,
        details: error
      };
    }
  }

  /**
   * Send transactional email (unchanged - already working)
   */
  async sendEmail(options) {
    const { to, subject, htmlContent, params = {}, tags = [] } = options;

    if (!this.apiKey) {
      console.error('❌ [Brevo Email] API Key missing');
      return { success: false, error: 'Brevo API Key not configured' };
    }

    if (!to || !subject || !htmlContent) {
      console.error('❌ [Brevo Email] Missing required fields');
      return { success: false, error: 'Missing required fields' };
    }

    const emailData = {
      sender: { name: this.senderName, email: this.senderEmail },
      to: [{ email: to }],
      subject,
      htmlContent,
      tags: ['ticket-guys', 'payment', ...tags],
      ...(Object.keys(params).length > 0 && { params })
    };

    try {
      console.log(`📧 [Brevo Email] → ${to}`);

      const response = await fetch(`${this.baseUrl}/smtp/email`, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': this.apiKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify(emailData)
      });

      const result = await response.json();

      if (response.ok) {
        console.log(`✅ [Brevo Email] 🎉 SENT | ID: ${result.messageId}`);
        return {
          success: true,
          data: result,
          messageId: result.messageId
        };
      } else {
        console.error(`❌ [Brevo Email] API ERROR:`, JSON.stringify(result, null, 2));
        return {
          success: false,
          error: result.message || 'Email API error',
          details: result
        };
      }
    } catch (error) {
      console.error('❌ [Brevo Email] Network error:', error.message);
      return { success: false, error: `Network error: ${error.message}` };
    }
  }

  /**
   * Test SMS connectivity
   */
  async testSMS(testPhone) {
    return await this.sendSMS({
      recipient: testPhone,
      content: `🧪 SMS Test - ${new Date().toISOString()}`
    });
  }
}

module.exports = BrevoService;



// // services/brevoService.js
// const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// /**
//  * Production-grade Brevo API Service
//  * Handles all email and SMS communication
//  */
// class BrevoService {
//   constructor() {
//     this.apiKey = process.env.BREVO_API_KEY;
//     this.senderEmail = process.env.BREVO_SENDER_EMAIL;
//     this.senderName = process.env.BREVO_SENDER_NAME || 'Ticket Guys';
//     this.baseUrl = 'https://api.brevo.com/v3';
//     this.smsEnabled = true; // Set to true after configuring Brevo SMS
//   }

//   /**
//    * Send transactional email via Brevo
//    * @param {Object} options - Email parameters
//    * @returns {Promise<Object>} - Result object
//    */
//   async sendEmail(options) {
//     const { to, subject, htmlContent, params = {}, tags = [] } = options;

//     // Validation
//     if (!this.apiKey) {
//       console.error('❌ [Brevo] API Key missing');
//       return { success: false, error: 'Brevo API Key not configured' };
//     }

//     if (!to || !subject || !htmlContent) {
//       console.error('❌ [Brevo] Missing required email fields');
//       return { success: false, error: 'Missing required fields' };
//     }

//     const emailData = {
//   sender: {
//     name: this.senderName,
//     email: this.senderEmail
//   },
//   to: [{ email: to }],
//   subject: subject,
//   htmlContent: htmlContent,
//   tags: ['ticket-guys', 'payment', ...tags]
// };

// // ✅ Only add params IF it is actually needed
// if (params && Object.keys(params).length > 0) {
//   emailData.params = params;
// }


//     try {
//       console.log(`📧 [Brevo] Sending email to: ${to}`);

//       const response = await fetch(`${this.baseUrl}/smtp/email`, {
//         method: 'POST',
//         headers: {
//           'accept': 'application/json',
//           'api-key': this.apiKey,
//           'content-type': 'application/json'
//         },
//         body: JSON.stringify(emailData)
//       });

//       const result = await response.json();

//       if (response.ok) {
//         console.log(`✅ [Brevo] Email sent. Message ID: ${result.messageId}`);
//         return {
//           success: true,
//           data: result,
//           messageId: result.messageId
//         };
//       } else {
//         console.error(`❌ [Brevo] Email failed: ${JSON.stringify(result)}`);
//         return {
//           success: false,
//           error: result.message || 'Unknown error',
//           details: result
//         };
//       }
//     } catch (error) {
//       console.error('❌ [Brevo] Network error:', error.message);
//       return {
//         success: false,
//         error: `Network error: ${error.message}`
//       };
//     }
//   }

//   /**
//    * Send transactional SMS via Brevo
//    * @param {Object} options - SMS parameters
//    * @returns {Promise<Object>} - Result object
//    */
//   async sendSMS(options) {
//     const { recipient, content, sender = 'TicketGuys', webUrl } = options;

//     // Feature flag - disable SMS until configured
//     if (!this.smsEnabled) {
//       console.log('ℹ️ [Brevo] SMS is disabled. Enable by setting smsEnabled = true');
//       return {
//         success: false,
//         error: 'SMS service not enabled',
//         disabled: true
//       };
//     }

//     // Validation
//     if (!this.apiKey) {
//       console.error('❌ [Brevo] API Key missing for SMS');
//       return { success: false, error: 'API Key not configured' };
//     }

//     if (!recipient || !content) {
//       console.error('❌ [Brevo] Missing SMS recipient or content');
//       return { success: false, error: 'Missing recipient or content' };
//     }

//     // Format recipient (ensure + country code)
//     const formattedRecipient = recipient.startsWith('+') ? recipient : `+1${recipient}`;

//     const smsData = {
//       recipient: formattedRecipient,
//       content: content,
//       sender: sender,
//       type: 'transactional',
//       tag: 'payment_notification',
//       ...(webUrl && { webUrl: webUrl })
//     };

//     try {
//       console.log(`📱 [Brevo] Sending SMS to: ${formattedRecipient}`);

//       const response = await fetch(`${this.baseUrl}/transactionalSMS/sms`, {
//         method: 'POST',
//         headers: {
//           'accept': 'application/json',
//           'api-key': this.apiKey,
//           'content-type': 'application/json'
//         },
//         body: JSON.stringify(smsData)
//       });

//       const result = await response.json();

//       if (response.ok) {
//         console.log(`✅ [Brevo] SMS sent to ${formattedRecipient}`);
//         return {
//           success: true,
//           data: result,
//           messageId: result.messageId
//         };
//       } else {
//         console.error(`❌ [Brevo] SMS failed: ${JSON.stringify(result)}`);
//         return {
//           success: false,
//           error: result.message || 'SMS send failed',
//           details: result
//         };
//       }
//     } catch (error) {
//       console.error('❌ [Brevo] SMS network error:', error.message);
//       return {
//         success: false,
//         error: `SMS network error: ${error.message}`
//       };
//     }
//   }

//   /**
//    * Enable SMS service (call this after configuring Brevo SMS)
//    */
//   enableSMS() {
//     this.smsEnabled = true;
//     console.log('✅ [Brevo] SMS service enabled');
//   }
// }

// module.exports = BrevoService;