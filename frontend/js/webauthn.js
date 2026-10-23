// Passkeys im Browser: wandelt die JSON-Optionen des Servers in WebAuthn-Aufrufe um und die Antwort zurück in JSON.

const toBuf = s => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0)).buffer;
};

const toB64 = buf => {
  let bin = '';
  new Uint8Array(buf).forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const creds = list => (list || []).map(c => ({ ...c, id: toBuf(c.id) }));

export const supported = () => typeof window.PublicKeyCredential === 'function' && window.isSecureContext;

/** Neuen Passkey anlegen. */
export async function createPasskey(o) {
  const cred = await navigator.credentials.create({
    publicKey: { ...o, challenge: toBuf(o.challenge), user: { ...o.user, id: toBuf(o.user.id) }, excludeCredentials: creds(o.excludeCredentials) },
  });
  const r = cred.response;
  return {
    id: cred.id,
    rawId: toB64(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: toB64(r.clientDataJSON),
      attestationObject: toB64(r.attestationObject),
      transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
    },
  };
}

/** Mit einem vorhandenen Passkey bestätigen. */
export async function usePasskey(o) {
  const cred = await navigator.credentials.get({
    publicKey: { ...o, challenge: toBuf(o.challenge), allowCredentials: creds(o.allowCredentials) },
  });
  const r = cred.response;
  return {
    id: cred.id,
    rawId: toB64(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: toB64(r.clientDataJSON),
      authenticatorData: toB64(r.authenticatorData),
      signature: toB64(r.signature),
      userHandle: r.userHandle ? toB64(r.userHandle) : undefined,
    },
  };
}

/** Sagt dem Passwort-Manager, dass es zu diesen Passkeys kein Konto mehr gibt (wo unterstützt). */
export function forgetPasskeys(rpId, ids) {
  if (typeof PublicKeyCredential.signalUnknownCredential !== 'function') return;
  ids.forEach(credentialId => PublicKeyCredential.signalUnknownCredential({ rpId, credentialId }).catch(() => {}));
}
