// templates/paymentTemplates.js
/**
 * Payment Email & SMS Templates
 * EXACTLY as specified in your document
 */

class PaymentTemplates {
  /**
   * Extract first name from ticket data
   * @param {Object} ticketData - Firestore ticket document
   * @returns {string} - First name or fallback
   */
  static getFirstName(ticketData) {
    return ticketData.extractedData?.violator_information?.first || 
           ticketData.extractedData?.first_name || 
           'there';
  }

  /**
   * Build portal URL for case tracking
   * @param {string} sessionId - Ticket session ID
   * @returns {string} - Full portal URL
   */
  static buildPortalUrl(sessionId) {
    const baseUrl = process.env.PORTAL_BASE_URL || process.env.FRONTEND_URL || 'https://your-portal.com';
    return `${baseUrl}/case/${sessionId}`;
  }

  /**
   * Build payment update URL
   * @param {string} sessionId - Ticket session ID
   * @returns {string} - Payment update URL
   */
  static buildPaymentUpdateUrl(sessionId) {
    const baseUrl = process.env.PAYMENT_UPDATE_BASE_URL || process.env.FRONTEND_URL || 'https://your-portal.com';
    return `${baseUrl}/payment/${sessionId}`;
  }

  /**
   * TG_PAYMENT_PAID - Payment Success Email
   * EXACT template from your document
   */
  static getPaymentPaidEmail(ticketData) {
    const firstName = this.getFirstName(ticketData);
    const caseId = ticketData.sessionId;
    const citationNumber = ticketData.extractedData?.ticket_header?.citation_number || 'N/A';
    const county = ticketData.extractedData?.ticket_header?.county || 'N/A';
    const courtName = ''; // Add if available in your data
    const portalUrl = this.buildPortalUrl(caseId);
    const supportPhone = process.env.SUPPORT_PHONE || 'your-support-phone';
    const businessHours = process.env.BUSINESS_HOURS || 'Mon-Fri 9am-5pm';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Received - Ticket Guys</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
          .footer { margin-top: 30px; font-size: 12px; color: #666; border-top: 1px solid #eee; padding-top: 15px; }
          .button { display: inline-block; background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
          .info-box { background-color: #e7f3ff; border-left: 4px solid #007bff; padding: 15px; margin: 15px 0; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>Payment Received</h2>
        </div>
        
        <p>Hi ${firstName},</p>
        
        <p>Payment received — your Ticket Guys case is now active.</p>
        
        <div class="info-box">
          <p><strong>Case ID:</strong> ${caseId}</p>
          <p><strong>Citation:</strong> ${citationNumber}</p>
          <p><strong>County/Court:</strong> ${county}${courtName ? ' — ' + courtName : ''}</p>
        </div>
        
        <h4>What happens next:</h4>
        <ul>
          <li>We review your citation details</li>
          <li>We begin the next steps for your case</li>
          <li>You'll receive automatic updates when your case status changes</li>
        </ul>
        
        <p><a href="${portalUrl}" class="button">Track Your Case Here</a></p>
        
        <p>Questions? Reply to this email or call/text ${supportPhone}.</p>
        
        <div class="footer">
          <p>— Ticket Guys</p>
          <p>${businessHours}</p>
          <p><em>Note: This message is informational and not legal advice.</em></p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * TG_PAYMENT_FAILED - Payment Failed Email
   * EXACT template from your document
   */
  static getPaymentFailedEmail(ticketData) {
    const firstName = this.getFirstName(ticketData);
    const caseId = ticketData.sessionId;
    const citationNumber = ticketData.extractedData?.ticket_header?.citation_number || 'N/A';
    const paymentUpdateUrl = this.buildPaymentUpdateUrl(caseId);
    const supportPhone = process.env.SUPPORT_PHONE || 'your-support-phone';
    const businessHours = process.env.BUSINESS_HOURS || 'Mon-Fri 9am-5pm';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Failed - Ticket Guys</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
          .footer { margin-top: 30px; font-size: 12px; color: #666; border-top: 1px solid #eee; padding-top: 15px; }
          .button { display: inline-block; background-color: #dc3545; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
          .warning-box { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 15px 0; }
          .urgent { color: #dc3545; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2 class="urgent">Payment Failed</h2>
        </div>
        
        <p>Hi ${firstName},</p>
        
        <p>Your payment didn't go through, so your case isn't fully active yet.</p>
        
        <div class="warning-box">
          <p class="urgent">In Texas, waiting can create avoidable problems (warrants/added fees and even driver's license renewal issues in some situations).</p>
          <p>If you want us to move forward, fix this now:</p>
        </div>
        
        <p><strong>Update payment here:</strong></p>
        <p><a href="${paymentUpdateUrl}" class="button">Update Payment Information</a></p>
        
        <div class="info-box">
          <p><strong>Case ID:</strong> ${caseId}</p>
          <p><strong>Citation:</strong> ${citationNumber}</p>
        </div>
        
        <p>If you want help by phone, call/text ${supportPhone} and we'll help immediately.</p>
        
        <div class="footer">
          <p>— Ticket Guys</p>
          <p>${businessHours}</p>
          <p><em>Note: This message is informational and not legal advice.</em></p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * TG_PAYMENT_PAID_SMS - Payment Success SMS
   * EXACT template from your document
   */
  static getPaymentPaidSms(ticketData) {
    const caseId = ticketData.sessionId;
    const portalUrl = this.buildPortalUrl(caseId);
    
    return `Ticket Guys: Payment received for case ${caseId}. We're getting to work now. Track updates: ${portalUrl} Reply STOP to opt out.`;
  }

  /**
   * TG_PAYMENT_FAILED_SMS - Payment Failed SMS
   * EXACT template from your document
   */
  static getPaymentFailedSms(ticketData) {
    const caseId = ticketData.sessionId;
    const paymentUpdateUrl = this.buildPaymentUpdateUrl(caseId);
    const supportPhone = process.env.SUPPORT_PHONE || 'your-support-phone';
    
    return `Ticket Guys: Your payment didn't go through for case ${caseId}. Update here: ${paymentUpdateUrl} Need help? ${supportPhone} Reply STOP to opt out.`;
  }

  /**
   * Get email subject for payment paid
   */
  static getPaymentPaidSubject() {
    return '✅ Payment Received - Your Ticket Guys Case is Active';
  }

  /**
   * Get email subject for payment failed
   */
  static getPaymentFailedSubject() {
    return '⚠️ Payment Failed - Action Required for Your Ticket';
  }
}

module.exports = PaymentTemplates;