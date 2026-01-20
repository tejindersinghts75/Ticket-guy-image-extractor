const statusService = require('./services/statusService');

async function start() {
  try {
    await statusService.start();
    console.log('✅ Status monitoring service is running');
  } catch (error) {
    console.error('❌ Failed to start status service:', error);
    process.exit(1);
  }
}

// Handle shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down status service...');
  statusService.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Shutting down status service...');
  statusService.stop();
  process.exit(0);
});

// Start the service
start();