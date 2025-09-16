# Deployment Guide

This guide explains how to deploy the GovCon FAR Audit application with automatic startup cleanup functionality.

## Startup Cleanup

The application includes an automatic cleanup script that removes all database files and uploaded documents **every time the service starts**. This ensures a fresh state for every restart, deployment, or service recovery.

### When Cleanup Runs

The cleanup script runs automatically on **ALL service starts** including:

1. **Service restarts** (manual or automatic)
2. **Deployments** (new code releases)
3. **System reboots** (server restarts)
4. **Container restarts** (Docker, Kubernetes, etc.)
5. **Platform restarts** (Heroku, Railway, etc.)
6. **Manual execution** (running the cleanup script directly)

### Disabling Cleanup

To disable automatic cleanup, set `CLEAN_ON_START=false`

### What Gets Cleaned

The startup cleanup removes:

- **Database files**: `data.sqlite`, `data.sqlite-shm`, `data.sqlite-wal`
- **Uploaded files**: All GL Excel files and document uploads (PDFs, images)
- **Temporary files**: Any temp, tmp, or cache directories

## Available Scripts

### Normal Operation (Cleanup Enabled)
```bash
# Standard start with automatic cleanup
npm start

# Development with automatic cleanup
npm run dev

# Manual cleanup only (doesn't start server)
npm run cleanup
```

### Disable Cleanup (For Development/Testing)
```bash
# Start without cleanup (preserves existing data)
npm run start:no-clean

# Development without cleanup (preserves existing data)
npm run dev:no-clean
```

## Environment Variables

### Cleanup Control
- `CLEAN_ON_START=false` - Disables automatic cleanup (cleanup runs by default)

### Upload Directory
- `UPLOAD_DIR` - Custom upload directory path (defaults to `/home/uploads`)

## Deployment Examples

### Docker Deployment
```dockerfile
# In your Dockerfile
# Cleanup runs automatically on container start
CMD ["npm", "start"]

# To disable cleanup in Docker:
# ENV CLEAN_ON_START=false
# CMD ["npm", "run", "start:no-clean"]
```

### Cloud Platform Deployment
```bash
# For platforms like Heroku, Railway, etc.
# Cleanup runs automatically on every dyno/instance restart

# To disable cleanup, set environment variable:
# CLEAN_ON_START=false
```

### Manual Server Deployment
```bash
# SSH into your server
cd /path/to/your/app

# Pull latest code
git pull origin main

# Install dependencies
npm install

# Start with automatic cleanup
npm start

# Or to preserve existing data:
npm run start:no-clean
```

## Cleanup Log Output

When cleanup runs, you'll see output like:
```
🔄 Service starting - performing cleanup...
🚀 Starting service restart cleanup...
⏰ Timestamp: 2024-XX-XXTXX:XX:XX.XXXZ
🧹 Cleaning uploads directory: /home/uploads
📁 Found 3 entries to clean: ['doc1.pdf', 'excel1.xlsx', 'image1.png']
✅ Deleted: doc1.pdf
✅ Deleted: excel1.xlsx
✅ Deleted: image1.png
🎉 Upload directory cleanup completed
🗄️ Cleaning database...
✅ Deleted database file: data.sqlite
✅ Deleted database file: data.sqlite-shm
🎉 Database cleanup completed (2 files removed)
🧽 Cleaning temporary files...
📝 No temporary directories found
🎉 Temp cleanup completed (0 directories removed)
✨ Startup cleanup completed successfully!
```

## Safety Notes

⚠️ **Warning**: The cleanup script **permanently deletes** all data including:
- All uploaded GL Excel files
- All document uploads (PDFs, images, etc.)
- All database records (GL entries, document links, etc.)

Only use cleanup scripts when you want a completely fresh start.

## Troubleshooting

### Cleanup Fails
If cleanup fails, check:
1. File permissions on upload directory
2. Database file locks (ensure no other processes are using the database)
3. Disk space and filesystem permissions

### Manual Cleanup
If you need to manually clean without starting the server:
```bash
npm run cleanup
```

This runs only the cleanup script without starting the application.