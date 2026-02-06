// services/brevoService.js
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

/**
 * Production-grade Brevo API Service
 * Handles all email and SMS communication
 */
class BrevoService {
  constructor() {
    this.apiKey = process.env.BREVO_API_KEY;
    this.senderEmail = process.env.BREVO_SENDER_EMAIL;
    this.senderName = process.env.BREVO_SENDER_NAME || 'Ticket Guys';
    this.baseUrl = 'https://api.brevo.com/v3';
    this.smsEnabled = true; // Set to true after configuring Brevo SMS
  }

  /**
   * Send transactional email via Brevo
   * @param {Object} options - Email parameters
   * @returns {Promise<Object>} - Result object
   */
  async sendEmail(options) {
    const { to, subject, htmlContent, params = {}, tags = [] } = options;

    // Validation
    if (!this.apiKey) {
      console.error('❌ [Brevo] API Key missing');
      return { success: false, error: 'Brevo API Key not configured' };
    }

    if (!to || !subject || !htmlContent) {
      console.error('❌ [Brevo] Missing required email fields');
      return { success: false, error: 'Missing required fields' };
    }

    const emailData = {
  sender: {
    name: this.senderName,
    email: this.senderEmail
  },
  to: [{ email: to }],
  subject: subject,
  htmlContent: htmlContent,
  tags: ['ticket-guys', 'payment', ...tags]
};

// ✅ Only add params IF it is actually needed
if (params && Object.keys(params).length > 0) {
  emailData.params = params;
}


    try {
      console.log(`📧 [Brevo] Sending email to: ${to}`);

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
        console.log(`✅ [Brevo] Email sent. Message ID: ${result.messageId}`);
        return {
          success: true,
          data: result,
          messageId: result.messageId
        };
      } else {
        console.error(`❌ [Brevo] Email failed: ${JSON.stringify(result)}`);
        return {
          success: false,
          error: result.message || 'Unknown error',
          details: result
        };
      }
    } catch (error) {
      console.error('❌ [Brevo] Network error:', error.message);
      return {
        success: false,
        error: `Network error: ${error.message}`
      };
    }
  }

  /**
   * Send transactional SMS via Brevo
   * @param {Object} options - SMS parameters
   * @returns {Promise<Object>} - Result object
   */
  async sendSMS(options) {
    const { recipient, content, sender = 'TicketGuys', webUrl } = options;

    // Feature flag - disable SMS until configured
    if (!this.smsEnabled) {
      console.log('ℹ️ [Brevo] SMS is disabled. Enable by setting smsEnabled = true');
      return {
        success: false,
        error: 'SMS service not enabled',
        disabled: true
      };
    }

    // Validation
    if (!this.apiKey) {
      console.error('❌ [Brevo] API Key missing for SMS');
      return { success: false, error: 'API Key not configured' };
    }

    if (!recipient || !content) {
      console.error('❌ [Brevo] Missing SMS recipient or content');
      return { success: false, error: 'Missing recipient or content' };
    }

    // Format recipient (ensure + country code)
    const formattedRecipient = recipient.startsWith('+') ? recipient : `+1${recipient}`;

    const smsData = {
      recipient: formattedRecipient,
      content: content,
      sender: sender,
      type: 'transactional',
      tag: 'payment_notification',
      ...(webUrl && { webUrl: webUrl })
    };

    try {
      console.log(`📱 [Brevo] Sending SMS to: ${formattedRecipient}`);

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
        console.log(`✅ [Brevo] SMS sent to ${formattedRecipient}`);
        return {
          success: true,
          data: result,
          messageId: result.messageId
        };
      } else {
        console.error(`❌ [Brevo] SMS failed: ${JSON.stringify(result)}`);
        return {
          success: false,
          error: result.message || 'SMS send failed',
          details: result
        };
      }
    } catch (error) {
      console.error('❌ [Brevo] SMS network error:', error.message);
      return {
        success: false,
        error: `SMS network error: ${error.message}`
      };
    }
  }

  /**
   * Enable SMS service (call this after configuring Brevo SMS)
   */
  enableSMS() {
    this.smsEnabled = true;
    console.log('✅ [Brevo] SMS service enabled');
  }
}

module.exports = BrevoService;