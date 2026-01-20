require('dotenv').config();
const brevoService = require('./brevoService');
const admin = require('firebase-admin');

class StatusNotification {
  constructor() {
    if (!admin.apps.length) {
      throw new Error('Firebase must be initialized first');
    }
    this.db = admin.firestore();
  }

  async sendForStatus(status, caseData, caseId) {
    try {
      this.validateInputs(status, caseData, caseId);
      const statusMessage = this.getStatusMessage(caseData, status);
      const emailData = this.prepareEmailData(status, caseData, caseId, statusMessage);
      
      await this.sendEmailWithRetry(emailData);
      console.log(`✅ Email sent for ${caseId} → ${status}`);
      
      if (caseData.smsOptedIn === true && caseData.phone) {
        await this.sendSms(status, caseData, caseId);
      }
      
      if (status === 'case_dismissed') {
        await this.scheduleReviewRequest(caseData, caseId);
      }
      
      await this.logNotification('email_sent', caseId, status, caseData.email);
      
    } catch (error) {
      console.error(`❌ Notification failed ${caseId}:`, error.message);
      throw error;
    }
  }

  validateInputs(status, caseData, caseId) {
    const validStatuses = [
      'approval_pending', 'case_approved', 'case_in_progress',
      'case_appealed', 'requires_attention', 'case_dismissed'
    ];
    
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }
    
    if (!caseData?.email) {
      throw new Error('Email required');
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(caseData.email)) {
      throw new Error('Invalid email format');
    }
  }

  getStatusMessage(caseData, status) {
    if (!caseData.clientMessages?.[status]) return '';
    return String(caseData.clientMessages[status]).replace(/[<>]/g, '').substring(0, 500);
  }

  prepareEmailData(status, caseData, caseId, statusMessage) {
    const baseUrl = process.env.PORTAL_BASE_URL || 'https://your-portal.com';
    const supportPhone = process.env.SUPPORT_PHONE || '(555) 123-4567';
    const businessHours = process.env.BUSINESS_HOURS || 'Mon-Fri 9am-6pm CT';
    
    const templateInfo = this.getTemplateInfo(status);
    const sanitizedData = this.sanitizeUserData(caseData);
    
    return {
      to: sanitizedData.email,
      name: sanitizedData.firstName || 'Customer',
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

  sanitizeUserData(caseData) {
    const sanitized = { ...caseData };
    const sensitive = ['password', 'ssn', 'cardNumber', 'cvv'];
    sensitive.forEach(field => delete sanitized[field]);
    
    Object.keys(sanitized).forEach(key => {
      if (typeof sanitized[key] === 'string') {
        sanitized[key] = sanitized[key].replace(/[<>]/g, '').substring(0, 1000);
      }
    });
    return sanitized;
  }

  async sendEmailWithRetry(emailData, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await brevoService.sendTransactionalEmail({
          subject: emailData.subject,
          htmlContent: emailData.htmlContent,
          to: [{ email: emailData.to, name: emailData.name }],
          params: emailData.params
        });
        console.log(`✅ Email sent to ${this.maskEmail(emailData.to)} (attempt ${attempt})`);
        return;
      } catch (error) {
        console.error(`Email attempt ${attempt} failed:`, error.message);
        if (attempt === maxRetries) throw error;
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }

  maskEmail(email) {
    const [name, domain] = email.split('@');
    if (!name || !domain) return 'unknown';
    const masked = name.length > 2 ? name.slice(0,2) + '*' : '**';
    return `${masked}@${domain}`;
  }

  getTemplateInfo(status) {
    const templates = {
      'approval_pending': {
        subject: 'Update: Case Now Approval Pending',
        html: `Hi {{first_name}},<br><br>
Update: your case status is now <strong>Approval Pending</strong>.<br><br>
What this means:<br>
• We've received your submission<br>
• Our team is reviewing it for acceptance<br>
Track your case: {{portal_url}}<br><br>
— Ticket Guys<br>
{{support_phone}}`
      },
      'case_approved': {
        subject: '✅ Approved - Moving Forward!',
        html: `Hi {{first_name}},<br><br>
<strong>Good news</strong> — your case is now <strong>Approved</strong>!<br><br>
• Case accepted by our team<br>
• Moving into active handling<br>
Track updates: {{portal_url}}<br><br>
— Ticket Guys`
      },
      'case_in_progress': {
        subject: '🔄 Case Now In Progress',
        html: `Hi {{first_name}},<br><br>
<strong>Update:</strong> Case {{case_id}} is now <strong>In Progress</strong>.<br><br>
Our team is actively working your case.<br>
We'll notify you if anything needed.<br><br>
Track: {{portal_url}}<br><br>
— Ticket Guys`
      },
      'case_appealed': {
        subject: '📋 Case Now Appealed',
        html: `Hi {{first_name}},<br><br>
<strong>Update:</strong> Case {{case_id}} is now <strong>Appealed</strong>.<br><br>
Your case has moved to appeal process.<br>
Check portal for updates: {{portal_url}}<br><br>
— Ticket Guys`
      },
      'requires_attention': {
        subject: '⚠️ Action Needed: {{case_id}}',
        html: `Hi {{first_name}},<br><br>
<strong>Requires Attention</strong> — we need one detail for case {{case_id}}.<br><br>
{{status_note}}<br><br>
<strong>Fastest fix:</strong><br>
• Reply to this email, or<br>
• Update here: {{portal_url}}<br><br>
— Ticket Guys | {{support_phone}}`
      },
      'case_dismissed': {
        subject: '🎉 Case {{case_id}} DISMISSED!',
        html: `Hi {{first_name}},<br><br>
<strong>🎉 GREAT NEWS!</strong> Case {{case_id}} is now <strong>Dismissed</strong> 🎉<br><br>
Details: {{status_note}}<br><br>
Save for records: {{portal_url}}<br><br>
— Ticket Guys`
      }
    };
    
    const template = templates[status];
    if (!template) throw new Error(`No template for ${status}`);
    return template;
  }

  async scheduleReviewRequest(caseData, caseId) {
    const scheduledTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.db.collection('scheduled_review_emails').add({
      caseId, email: caseData.email, firstName: caseData.firstName || '',
      scheduledFor: scheduledTime, status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`⏰ Review scheduled: ${caseId}`);
  }

  async logNotification(type, caseId, status, email) {
    await this.db.collection('notification_logs').add({
      type, caseId, status, email: this.maskEmail(email),
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  // SMS methods (stubbed - implement when ready)
  async sendSms() { console.log('📱 SMS ready when implemented'); }
}

module.exports = new StatusNotification();
