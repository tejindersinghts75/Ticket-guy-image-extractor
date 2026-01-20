require('dotenv').config(); // ✅ Load environment variables FIRST

const brevoService = require('./brevoService');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

class StatusNotification {
  constructor() {
    // ✅ SECURE: Initialize Firebase ONLY if not already initialized
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    }
    
    this.db = getFirestore();
  }
  
  async sendForStatus(status, caseData, caseId) {
    // ✅ SECURE: Input validation
    this.validateInputs(status, caseData, caseId);
    
    // ✅ SECURE: Get status message safely
    const statusMessage = this.getStatusMessage(caseData, status);
    
    // ✅ SECURE: Prepare email data with validation
    const emailData = this.prepareEmailData(status, caseData, caseId, statusMessage);
    
    // ✅ SECURE: Send email with retry
    await this.sendEmailWithRetry(emailData);
    
    // ✅ SECURE: Send SMS if opted in (with validation)
    if (caseData.smsOptedIn === true && caseData.phone) {
      await this.sendSms(status, caseData, caseId);
    }
    
    // ✅ SECURE: Schedule review for dismissed
    if (status === 'case_dismissed') {
      await this.scheduleReviewRequest(caseData, caseId);
    }
    
    // ✅ SECURE: Log successful send (sanitized)
    await this.logNotification('email_sent', caseId, status, caseData.email);
  }
  
  validateInputs(status, caseData, caseId) {
    // ✅ SECURE: Validate status
    const validStatuses = [
      'approval_pending',
      'case_approved',
      'case_in_progress',
      'case_appealed',
      'requires_attention',
      'case_dismissed'
    ];
    
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }
    
    // ✅ SECURE: Validate required fields
    if (!caseData || typeof caseData !== 'object') {
      throw new Error('caseData must be an object');
    }
    
    if (!caseData.email || typeof caseData.email !== 'string') {
      throw new Error('Valid email is required');
    }
    
    // ✅ SECURE: Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(caseData.email)) {
      throw new Error('Invalid email format');
    }
    
    if (!caseId || typeof caseId !== 'string' || caseId.length < 3) {
      throw new Error('Valid caseId is required');
    }
  }
  
  getStatusMessage(caseData, status) {
    // ✅ SECURE: Safely get message from clientMessages
    if (!caseData.clientMessages || typeof caseData.clientMessages !== 'object') {
      return '';
    }
    
    const message = caseData.clientMessages[status];
    
    // ✅ SECURE: Sanitize message to prevent XSS
    if (typeof message === 'string') {
      return message.replace(/[<>]/g, '').substring(0, 500); // Limit length
    }
    
    return '';
  }
  
  prepareEmailData(status, caseData, caseId, statusMessage) {
    // ✅ SECURE: Validate environment variables exist
    const baseUrl = this.validateEnvVariable('PORTAL_BASE_URL', 'https://portal.yourdomain.com');
    const supportPhone = this.validateEnvVariable('SUPPORT_PHONE', '(555) 123-4567');
    const businessHours = process.env.BUSINESS_HOURS || 'Mon-Fri 9am-6pm CT';
    
    // ✅ SECURE: Map status to template
    const templateInfo = this.getTemplateInfo(status);
    
    // ✅ SECURE: Sanitize all user inputs
    const sanitizedData = this.sanitizeUserData(caseData);
    
    return {
      to: sanitizedData.email,
      name: sanitizedData.firstName || '',
      subject: templateInfo.subject,
      htmlContent: templateInfo.html,
      params: {
        first_name: sanitizedData.firstName || '',
        case_id: caseId,
        citation_number: sanitizedData.citationNumber || '',
        county: sanitizedData.county || '',
        court_name: sanitizedData.courtName || '',
        portal_url: `${baseUrl}/case/${caseId}`,
        status_note: statusMessage,
        support_phone: supportPhone,
        business_hours: businessHours
      }
    };
  }
  
  validateEnvVariable(varName, defaultValue = '') {
    const value = process.env[varName];
    
    // ✅ SECURE: In production, require the variable
    if (process.env.NODE_ENV === 'production' && !value) {
      throw new Error(`Required environment variable missing: ${varName}`);
    }
    
    // ✅ SECURE: Validate URL format for URLs
    if (varName.includes('URL') && value) {
      try {
        new URL(value);
      } catch (e) {
        throw new Error(`Invalid URL in ${varName}: ${value}`);
      }
    }
    
    return value || defaultValue;
  }
  
  sanitizeUserData(caseData) {
    const sanitized = { ...caseData };
    
    // ✅ SECURE: Remove any sensitive fields
    const sensitiveFields = [
      'privateKey', 'password', 'ssn', 'creditCard', 
      'cardNumber', 'cvv', 'expiration'
    ];
    
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        delete sanitized[field];
      }
    });
    
    // ✅ SECURE: Sanitize string fields
    Object.keys(sanitized).forEach(key => {
      if (typeof sanitized[key] === 'string') {
        // Remove HTML tags and limit length
        sanitized[key] = sanitized[key]
          .replace(/[<>]/g, '')
          .substring(0, 1000);
      }
    });
    
    return sanitized;
  }
  
  async sendEmailWithRetry(emailData, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // ✅ SECURE: Validate email data before sending
        this.validateEmailData(emailData);
        
        await brevoService.sendTransactionalEmail({
          subject: emailData.subject,
          htmlContent: emailData.htmlContent,
          to: [{ email: emailData.to, name: emailData.name }],
          params: emailData.params
        });
        
        console.log(`✅ Email sent to ${this.maskEmail(emailData.to)} (attempt ${attempt})`);
        return;
        
      } catch (error) {
        console.error(`Email attempt ${attempt} failed for ${this.maskEmail(emailData.to)}:`, error.message);
        
        if (attempt === maxRetries) {
          throw new Error(`Failed to send email after ${maxRetries} attempts`);
        }
        
        // ✅ SECURE: Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }
  
  validateEmailData(emailData) {
    if (!emailData || typeof emailData !== 'object') {
      throw new Error('Invalid email data');
    }
    
    if (!emailData.to || typeof emailData.to !== 'string') {
      throw new Error('Invalid recipient email');
    }
    
    if (!emailData.subject || typeof emailData.subject !== 'string') {
      throw new Error('Invalid email subject');
    }
    
    if (!emailData.htmlContent || typeof emailData.htmlContent !== 'string') {
      throw new Error('Invalid email content');
    }
    
    // ✅ SECURE: Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailData.to)) {
      throw new Error('Invalid email format');
    }
  }
  
  maskEmail(email) {
    if (!email || typeof email !== 'string') return 'unknown';
    
    const [name, domain] = email.split('@');
    if (!name || !domain) return 'invalid';
    
    // ✅ SECURE: Mask email in logs for privacy
    const maskedName = name.length > 2 
      ? name.substring(0, 2) + '*'.repeat(name.length - 2)
      : '**';
    
    return `${maskedName}@${domain}`;
  }
  
  getTemplateInfo(status) {
    // ✅ SECURE: Templates are hardcoded (not user input)
    const templates = {
      'approval_pending': {
        subject: 'Update: your case status is now Approval Pending',
        html: `Hi {{first_name}},<br><br>Update: your case status is now Approval Pending...` // Your full template
      },
      'case_approved': {
        subject: 'Good news — your case status is now Approved',
        html: `Hi {{first_name}},<br><br>Good news — your case status is now Approved...`
      },
      'case_in_progress': {
        subject: 'Update: your case status is now In Progress',
        html: `Hi {{first_name}},<br><br>Update: your case status is now In Progress...`
      },
      'case_appealed': {
        subject: 'Update: your case status is now Appealed',
        html: `Hi {{first_name}},<br><br>Update: your case status is now Appealed...`
      },
      'requires_attention': {
        subject: 'Update: your case status now Requires Attention',
        html: `Hi {{first_name}},<br><br>Your case status is now Requires Attention...`
      },
      'case_dismissed': {
        subject: 'Great news — your case status is now Dismissed 🎉',
        html: `Hi {{first_name}},<br><br>Great news — your case status is now Dismissed 🎉...`
      }
    };
    
    const template = templates[status];
    if (!template) {
      throw new Error(`No email template for status: ${status}`);
    }
    
    return template;
  }
  
  async sendSms(status, caseData, caseId) {
    // ✅ SECURE: Validate phone number
    if (!this.isValidPhoneNumber(caseData.phone)) {
      console.warn(`Invalid phone number for case ${caseId}`);
      return;
    }
    
    const smsTemplates = {
      'approval_pending': `Ticket Guys: Case ${caseId} is now "Approval Pending." Updates: {{portal_url}} Reply STOP to opt out.`,
      'case_approved': `Ticket Guys: Case ${caseId} is now "Approved." We're moving forward. {{portal_url}} Reply STOP to opt out.`,
      'case_in_progress': `Ticket Guys: Case ${caseId} is now "In Progress." Updates: {{portal_url}} Reply STOP to opt out.`,
      'case_appealed': `Ticket Guys: Case ${caseId} is now "Appealed." Updates: {{portal_url}} Reply STOP to opt out.`,
      'requires_attention': `Ticket Guys: We need a quick detail for case ${caseId}. Check: {{portal_url}} or reply here. Reply STOP to opt out.`,
      'case_dismissed': `Ticket Guys: Congrats — case ${caseId} is "Dismissed." Details: {{portal_url}} Reply STOP to opt out.`
    };
    
    const template = smsTemplates[status];
    if (!template) {
      console.warn(`No SMS template for status: ${status}`);
      return;
    }
    
    // ✅ SECURE: Get URLs from environment
    const baseUrl = this.validateEnvVariable('PORTAL_BASE_URL');
    const portalUrl = `${baseUrl}/case/${caseId}`;
    
    // ✅ SECURE: Replace variables
    const smsBody = template
      .replace('{{portal_url}}', portalUrl)
      .replace('{{case_id}}', caseId);
    
    // ✅ SECURE: Log masked phone number
    console.log(`📱 SMS would send to ${this.maskPhone(caseData.phone)}: ${smsBody.substring(0, 50)}...`);
    
    // TODO: Implement SMS provider (Twilio, Brevo SMS, etc.)
    // await smsProvider.send({
    //   to: caseData.phone,
    //   body: smsBody
    // });
  }
  
  isValidPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return false;
    
    // ✅ SECURE: Basic phone validation
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length >= 10;
  }
  
  maskPhone(phone) {
    if (!phone || typeof phone !== 'string') return 'unknown';
    
    // ✅ SECURE: Mask phone in logs
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length < 4) return '***';
    
    const lastFour = cleaned.slice(-4);
    return `***-***-${lastFour}`;
  }
  
  async scheduleReviewRequest(caseData, caseId) {
    const scheduledTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    try {
      await this.db.collection('scheduled_review_emails').add({
        caseId,
        email: caseData.email,
        firstName: caseData.firstName || '',
        scheduledFor: scheduledTime,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log(`⏰ Review email scheduled for ${scheduledTime.toISOString()}`);
      
    } catch (error) {
      console.error('Failed to schedule review email:', error.message);
      throw error;
    }
  }
  
  async logNotification(type, caseId, status, email) {
    try {
      await this.db.collection('notification_logs').add({
        type,
        caseId,
        status,
        email: this.maskEmail(email), // ✅ SECURE: Store masked email
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.warn('Failed to log notification:', error.message);
    }
  }
}

module.exports = new StatusNotification();