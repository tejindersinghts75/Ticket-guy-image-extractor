const admin = require('firebase-admin');
const statusNotification = require('./statusNotification');

class StatusService {
  constructor() {
    this.db = null;
    this.isActive = false;
    this.unsubscribe = null;
    this.processingIds = new Set();
    this.rateLimit = new Map();
  }

  async initDb() {
    if (!this.db && admin.apps.length) {
      this.db = admin.firestore();
    }
    return this.db;
  }

  async start() {
    if (this.isActive) {
      console.warn('Status listener already active');
      return;
    }

    try {
      await this.initDb();
      if (!this.db) throw new Error('Firebase not ready');

      const casesRef = this.db.collection('tickets');
      
      this.unsubscribe = casesRef.onSnapshot(
        (snapshot) => this.handleSnapshot(snapshot),
        (error) => this.handleListenerError(error)
      );
      
      this.isActive = true;
      console.log('✅ Status listener started - monitoring tickets collection');
      
      setInterval(() => this.cleanupRateLimits(), 60 * 60 * 1000);
      
    } catch (error) {
      console.error('❌ Failed to start status listener:', error);
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
    console.log(`🔥 Snapshot: ${snapshot.docChanges().length} changes`);
    snapshot.docChanges().forEach((change) => {
      console.log(`📄 Change: ${change.type} → ${change.doc.id}`);
      if (change.type === 'modified') {
        setImmediate(() => this.processStatusChange(change));
      }
    });
  }

  async processStatusChange(change) {
    const caseId = change.doc.id;
    
    if (this.processingIds.has(caseId)) {
      console.warn(`⏳ Already processing ${caseId}`);
      return;
    }
    
    if (this.isRateLimited(caseId)) {
      console.warn(`⏱️ Rate limited ${caseId}`);
      return;
    }
    
    try {
      this.processingIds.add(caseId);
      
      // ✅ FIXED: Use change.doc.data() for new data
      const oldData = change.doc.data();
      const newData = change.doc.data();
      
      if (!this.isValidStatusChange(oldData, newData, caseId)) {
        console.log(`❌ Invalid change for ${caseId}`);
        return;
      }
      
      const oldStatus = oldData?.caseStatus || 'unknown';
      const newStatus = newData.caseStatus;
      
      await this.logStatusChange(caseId, oldStatus, newStatus);
      console.log(`📝 Status: ${caseId} - ${oldStatus} → ${newStatus}`);
      
      // Fire and forget
      statusNotification.sendForStatus(newStatus, newData, caseId)
        .catch(error => {
          console.error(`❌ Notifications failed ${caseId}:`, error.message);
          this.sendAdminAlert(caseId, error);
        });
        
      this.updateRateLimit(caseId);
      
    } catch (error) {
      console.error(`💥 Error ${caseId}:`, error.message);
      this.sendAdminAlert(caseId, error);
    } finally {
      this.processingIds.delete(caseId);
    }
  }

  isValidStatusChange(oldData, newData, caseId) {
    if (!newData?.caseStatus) {
      console.warn(`❌ No caseStatus: ${caseId}`);
      return false;
    }
    
    const validStatuses = [
      'approval_pending', 'case_approved', 'case_in_progress',
      'case_appealed', 'requires_attention', 'case_dismissed'
    ];
    
    if (!validStatuses.includes(newData.caseStatus)) {
      console.warn(`❌ Invalid status ${newData.caseStatus}`);
      return false;
    }
    
    if (!newData.email || typeof newData.email !== 'string') {
      console.warn(`❌ No email: ${caseId}`);
      return false;
    }
    
    return true;
  }

  isRateLimited(caseId) {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    let timestamps = this.rateLimit.get(caseId) || [];
    timestamps = timestamps.filter(ts => ts > oneMinuteAgo);
    return timestamps.length >= 5;
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

  async logStatusChange(caseId, oldStatus, newStatus) {
    try {
      await this.initDb();
      await this.db.collection('audit-logs').add({
        type: 'status_change',
        caseId, oldStatus, newStatus,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        source: 'status_service'
      });
    } catch (error) {
      console.warn('Log failed:', error.message);
    }
  }

  async sendAdminAlert(caseId, error) {
    try {
      await this.initDb();
      await this.db.collection('admin_alerts').add({
        type: 'status_error',
        caseId,
        error: error.message,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.error('Admin alert failed:', error.message);
    }
  }

  handleListenerError(error) {
    console.error('🔥 Listener error:', error.message);
    setTimeout(() => {
      console.log('🔄 Restarting listener...');
      this.stop();
      this.start().catch(err => console.error('Restart failed:', err));
    }, 5000);
  }
}

module.exports = new StatusService();
