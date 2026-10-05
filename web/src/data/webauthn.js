/* Clés d'accès (passkeys / WebAuthn) : conversions base64url <-> ArrayBuffer autour de l'API native
   du navigateur (credentials.create/get) — pas de librairie cliente, le serveur (@simplewebauthn/server)
   fait tout le travail cryptographique. */
import { api } from "./store.js";

const b64uToBuf = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(s.length + (4 - s.length % 4) % 4, "=")), c => c.charCodeAt(0));
const bufToB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const passkeySupported = () => typeof window !== "undefined" && !!window.PublicKeyCredential;

export async function registerPasskey(name){
  const options = await api("POST", "/api/me/passkeys/options");
  const publicKey = {
    ...options,
    challenge: b64uToBuf(options.challenge),
    user: { ...options.user, id: b64uToBuf(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map(c => ({ ...c, id: b64uToBuf(c.id) })),
  };
  const cred = await navigator.credentials.create({ publicKey });
  const response = {
    id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
    response: {
      clientDataJSON: bufToB64u(cred.response.clientDataJSON),
      attestationObject: bufToB64u(cred.response.attestationObject),
      transports: cred.response.getTransports ? cred.response.getTransports() : undefined,
    },
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
  };
  return api("POST", "/api/me/passkeys", { response, name });
}

export async function loginWithPasskey(){
  const { options, cid } = await api("POST", "/api/auth/passkey/options");
  const publicKey = {
    ...options,
    challenge: b64uToBuf(options.challenge),
    allowCredentials: (options.allowCredentials || []).map(c => ({ ...c, id: b64uToBuf(c.id) })),
  };
  const cred = await navigator.credentials.get({ publicKey });
  const response = {
    id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
    response: {
      clientDataJSON: bufToB64u(cred.response.clientDataJSON),
      authenticatorData: bufToB64u(cred.response.authenticatorData),
      signature: bufToB64u(cred.response.signature),
      userHandle: cred.response.userHandle ? bufToB64u(cred.response.userHandle) : undefined,
    },
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
  };
  return api("POST", "/api/auth/passkey/verify", { cid, response });
}
