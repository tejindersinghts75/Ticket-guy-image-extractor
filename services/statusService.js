const admin = require('firebase-admin');
const statusNotification = require('./statusNotification');

class StatusService {
  constructor() {
    this.db = admin.firestore();
    this.isActive = false;
    this.unsubscribe = null;
    this.processingIds = new Set(); // Track currently processing IDs
    this.rateLimit = new Map(); // Rate limiting per case
  }
  
  async start() {
    if (this.isActive) {
      console.warn('Status listener already active');
      return;
    }
    
    try {
      const casesRef = this.db.collection('tickets');
      
      this.unsubscribe = casesRef.onSnapshot(
        (snapshot) => this.handleSnapshot(snapshot),
        (error) => this.handleListenerError(error)
      );
      
      this.isActive = true;
      console.log('✅ Status listener started');
      
      // Cleanup old rate limits every hour
      setInterval(() => this.cleanupRateLimits(), 60 * 60 * 1000);
      
    } catch (error) {
      console.error('Failed to start status listener:', error);
      throw error;
    }
  }
  
  stop() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.isActive = false;
    console.log('🛑 Status listener stopped');
  }
  
  handleSnapshot(snapshot) {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'modified') {
        // Process asynchronously to not block listener
        setImmediate(() => this.processStatusChange(change));
      }
    });
  }
  
  async processStatusChange(change) {
    const caseId = change.doc.id;
    
    // 1. Check if already processing this case (idempotency)
    if (this.processingIds.has(caseId)) {
      console.warn(`Already processing case ${caseId}, skipping`);
      return;
    }
    
    // 2. Rate limiting: max 5 status changes per minute per case
    if (this.isRateLimited(caseId)) {
      console.warn(`Rate limited for case ${caseId}`);
      return;
    }
    
    try {
      this.processingIds.add(caseId);
      
      const oldData = change.doc.previous.data();
      const newData = change.doc.data();
      
      // 3. Validate data exists
      if (!this.isValidStatusChange(oldData, newData)) {
        return;
      }
      
      const oldStatus = oldData.caseStatus;
      const newStatus = newData.caseStatus;
      
      // 4. Log for audit trail
      await this.logStatusChange(caseId, oldStatus, newStatus);
      
      console.log(`📝 Status: ${caseId} - ${oldStatus} → ${newStatus}`);
      
      // 5. Send notifications (async, don't await)
      this.sendNotificationsAsync(newStatus, newData, caseId)
        .catch(error => {
          console.error(`Failed to send notifications for ${caseId}:`, error);
          this.sendAdminAlert(caseId, error);
        });
      
      // 6. Update rate limit
      this.updateRateLimit(caseId);
      
    } catch (error) {
      console.error(`Error processing ${caseId}:`, error);
      this.sendAdminAlert(caseId, error);
    } finally {
      this.processingIds.delete(caseId);
    }
  }
  
  isValidStatusChange(oldData, newData) {
    // Basic validation
    if (!oldData || !newData) return false;
    if (!oldData.caseStatus || !newData.caseStatus) return false;
    if (oldData.caseStatus === newData.caseStatus) return false;
    
    // Validate new status is known
    const validStatuses = [
      'approval_pending',
      'case_approved',
      'case_in_progress',
      'case_appealed',
      'requires_attention',
      'case_dismissed'
    ];
    
    if (!validStatuses.includes(newData.caseStatus)) {
      console.warn(`Invalid status: ${newData.caseStatus}`);
      return false;
    }
    
    // Validate required fields for email
    if (!newData.email || typeof newData.email !== 'string') {
      console.warn(`Missing or invalid email for case`);
      return false;
    }
    
    return true;
  }
  
  isRateLimited(caseId) {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    
    let timestamps = this.rateLimit.get(caseId) || [];
    timestamps = timestamps.filter(ts => ts > oneMinuteAgo);
    
    // Max 5 changes per minute
    if (timestamps.length >= 5) {
      return true;
    }
    
    return false;
  }
  
  updateRateLimit(caseId) {
    const now = Date.now();
    let timestamps = this.rateLimit.get(caseId) || [];
    timestamps.push(now);
    this.rateLimit.set(caseId, timestamps);
  }
  
  cleanupRateLimits() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    
    for (const [caseId, timestamps] of this.rateLimit.entries()) {
      const filtered = timestamps.filter(ts => ts > oneHourAgo);
      if (filtered.length === 0) {
        this.rateLimit.delete(caseId);
      } else {
        this.rateLimit.set(caseId, filtered);
      }
    }
  }
  
  async sendNotificationsAsync(status, caseData, caseId) {
    try {
      await statusNotification.sendForStatus(status, caseData, caseId);
    } catch (error) {
      // Retry once after 5 seconds
      await new Promise(resolve => setTimeout(resolve, 5000));
      await statusNotification.sendForStatus(status, caseData, caseId);
    }
  }
  
  async logStatusChange(caseId, oldStatus, newStatus) {
    try {
      await this.db.collection('audit-logs').add({
        type: 'status_change',
        caseId,
        oldStatus,
        newStatus,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        source: 'status_service'
      });
    } catch (error) {
      console.warn('Failed to log status change:', error);
    }
  }
  
  async sendAdminAlert(caseId, error) {
    try {
      await this.db.collection('admin_alerts').add({
        type: 'status_processing_error',
        caseId,
        error: error.message,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (alertError) {
      console.error('Failed to send admin alert:', alertError);
    }
  }
  
  handleListenerError(error) {
    console.error('Firestore listener error:', error);
    
    // Exponential backoff restart
    setTimeout(() => {
      console.log('Restarting status listener...');
      this.stop();
      this.start().catch(err => {
        console.error('Failed to restart listener:', err);
      });
    }, 5000);
  }
}

module.exports = new StatusService();