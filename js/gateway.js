import { auth } from './firebase-config.js';

// Where the blockchain gateway is running. Change this when it moves to a server.
export const GATEWAY_URL = 'http://localhost:3000';

export async function callGateway(path, { method = 'GET', body } = {}) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You are not signed in.');
  }
  const token = await user.getIdToken();

  let response;
  try {
    response = await fetch(`${GATEWAY_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('Cannot reach the blockchain gateway. Is it running?');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Gateway error (${response.status})`);
  }
  return data;
}