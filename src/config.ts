// Dynamically determine API base to support LAN access (e.g., accessing via 192.168.x.x from phone)
// Fallback to 'localhost' if hostname is empty to ensure valid URL construction
const hostname = window.location.hostname || 'localhost';

// Backend is running on port 5001 according to start script logs
export const API_BASE = `http://${hostname}:5001`;
