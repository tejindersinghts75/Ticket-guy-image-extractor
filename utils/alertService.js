// utils/alertService.js
const { FieldValue } = require('firebase-admin/firestore');

let db;

// Initialize Firestore if not already done
try {
  const { getFirestore } = require('firebase-admin/firestore');
  db = getFirestore();
} catch (error) {
  console.warn('⚠️ [AlertService] Firestore not initialized');
}

/**
 * Admin Alert Service
 * Creates admin_alerts in Firestore for failed payments
 */
class AlertService {
  /**
   * Create a payment failed admin alert
   * @param {Object} ticketData - The ticket document data
   * @param {string} errorReason - Stripe error reason
   * @returns {Promise<Object>} - Result of creation
   */
  static async createPaymentFailedAlert(ticketData, errorReason = 'Unknown error') {
    if (!db) {
      console.error('❌ [AlertService] Firestore not available');
      return { success: false, error: 'Firestore not initialized' };
    }

    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const alertRef = db.collection('admin_alerts').doc(alertId);

    const alertData = {
      id: alertId,
      type: 'payment_failed',
      status: 'open', // open, in_progress, resolved
      priority: 'high',
      
      // Client/Case Info
      clientInfo: {
        email: ticketData.email,
        firstName: ticketData.extractedData?.violator_information?.first || 'Unknown',
        lastName: ticketData.extractedData?.violator_information?.last_name || 'Unknown',
        phone: ticketData.phoneNumber || ticketData.extractedData?.phone_number || 'Not provided'
      },
      
      caseInfo: {
        sessionId: ticketData.sessionId,
        caseId: ticketData.sessionId,
        citationNumber: ticketData.extractedData?.ticket_header?.citation_number || 'N/A',
        county: ticketData.extractedData?.ticket_header?.county || 'N/A',
        amount: ticketData.paymentAmount || 'Unknown',
        paymentIntentId: ticketData.stripePaymentIntentId || 'N/A'
      },
      
      // Error Details
      errorDetails: {
        reason: errorReason,
        timestamp: new Date(),
        retryCount: 0
      },
      
      // Metadata
      createdAt: new Date(),
      updatedAt: new Date(),
      assignedTo: null,
      resolvedAt: null,
      notes: []
    };

    try {
      await alertRef.set(alertData);
      
      console.log(`✅ [AlertService] Admin alert created: ${alertId}`);
      
      // Also log in audit logs
      await this.logAudit('payment_failed_alert', ticketData.sessionId, {
        alertId: alertId,
        errorReason: errorReason
      });
      
      return { 
        success: true, 
        alertId: alertId,
        data: alertData 
      };
    } catch (error) {
      console.error(`❌ [AlertService] Failed to create alert: ${error.message}`);
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * Update alert status
   * @param {string} alertId - Alert document ID
   * @param {Object} updates - Fields to update
   */
  static async updateAlert(alertId, updates) {
    if (!db) {
      console.error('❌ [AlertService] Firestore not available');
      return { success: false, error: 'Firestore not initialized' };
    }

    try {
      const alertRef = db.collection('admin_alerts').doc(alertId);
      await alertRef.update({
        ...updates,
        updatedAt: new Date()
      });
      
      console.log(`✅ [AlertService] Alert ${alertId} updated`);
      return { success: true };
    } catch (error) {
      console.error(`❌ [AlertService] Failed to update alert: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add note to alert
   * @param {string} alertId - Alert document ID
   * @param {string} note - Note content
   * @param {string} author - Who added the note
   */
  static async addAlertNote(alertId, note, author = 'system') {
    if (!db) {
      console.error('❌ [AlertService] Firestore not available');
      return { success: false, error: 'Firestore not initialized' };
    }

    try {
      const alertRef = db.collection('admin_alerts').doc(alertId);
      await alertRef.update({
        notes: FieldValue.arrayUnion({
          note: note,
          author: author,
          timestamp: new Date()
        }),
        updatedAt: new Date()
      });
      
      console.log(`✅ [AlertService] Note added to alert ${alertId}`);
      return { success: true };
    } catch (error) {
      console.error(`❌ [AlertService] Failed to add note: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Log audit event
   * @param {string} action - Action performed
   * @param {string} sessionId - Ticket session ID
   * @param {Object} metadata - Additional data
   * 
   */
  static async logAudit(action, sessionId, metadata = {}) {
    if (!db) {
      console.error('❌ [AlertService] Firestore not available for audit');
      return;
    }

    try {
      await db.collection('audit-logs').add({
        action: action,
        timestamp: new Date(),
        sessionId: sessionId,
        metadata: metadata,
        source: 'payment_automation'
      });
    } catch (error) {
      console.error(`❌ [AlertService] Audit log failed: ${error.message}`);
    }
  }
}

module.exports = AlertService;