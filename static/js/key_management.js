// Initialize IndexedDB
const dbName = "KeyDatabase";
const storeName = "Keys";

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onerror = (event) => reject(event);
    request.onsuccess = (event) => 
    resolve(event.target.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      db.createObjectStore(storeName, { keyPath: "id" });
      console.log('Opened IndexedDB successfully:', event.target.result);
    };
  });
}

export function isValidEmail(email) {
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;
  return emailRegex.test(email);
}

export async function emailExists(email) {
  const db = await openIndexedDB();
  const transaction = db.transaction(storeName, "readonly");
  const keyStore = transaction.objectStore(storeName);
  const publicKeyRequest = keyStore.getKey(email + "_publicKey");
  const privateKeyRequest = keyStore.getKey(email + "_privateKey");

  return new Promise((resolve, reject) => {
    publicKeyRequest.onsuccess = () => {
      if (publicKeyRequest.result !== undefined) {
        privateKeyRequest.onsuccess = () => {
          resolve(privateKeyRequest.result !== undefined);
        };
        privateKeyRequest.onerror = (event) => {
          reject(event);
        };
      } else {
        resolve(false);
      }
    };
    publicKeyRequest.onerror = (event) => {
      reject(event);
    };
  });
}

export async function userExists(email) {
  const response = await fetch('/api/user_exists', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });

  const data = await response.json();
  return data.exists;
}

// Generate key pair
export async function generateKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    {
      publicKey: ["encrypt"],
      privateKey: ["decrypt"],
    }
  );
  return keyPair;
}


// Export private key
export async function exportPrivateKey(privateKey) {
  const exported = await crypto.subtle.exportKey("pkcs8", privateKey);
  const exportedKey = new Uint8Array(exported)
  return exportedKey;
}

// Export public key
export async function exportPublicKey(publicKey) {
  const exported = await crypto.subtle.exportKey("spki", publicKey);
  return new Uint8Array(exported);
}

// Import public key
export async function importPublicKey(exportedKey) {
  const publicKey = await crypto.subtle.importKey(
    "spki",
    exportedKey,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["encrypt"]
  );
  return publicKey;
}

// Import private key
async function importPrivateKey(exportedKey) {
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    exportedKey,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    true,
    ['decrypt']
  );
  return privateKey;
}

// Store key pair in IndexedDB
export async function storeKeyPair(email, keyPair) {
  const normalisedEmail = email.toLowerCase();
  if (!isValidEmail(normalisedEmail)) {
    console.error('Invalid email address');
    return false;
  }
  if (await emailExists(normalisedEmail)) {
    console.error('Email already in use');
    return false;
  }
  try {
    const publicKeyData = await exportPublicKey(keyPair.publicKey);
    const privateKeyData = await exportPrivateKey(keyPair.privateKey);

    const db = await openIndexedDB();
    const transaction = db.transaction(storeName, "readwrite");
    const keyStore = transaction.objectStore(storeName);

    const publicKeyAddRequest = keyStore.add({ id: email + "_publicKey", keyData: publicKeyData });
    publicKeyAddRequest.onerror = (event) => {
      console.error('Error storing public key:', event);
    };
    const privateKeyAddRequest = keyStore.add({ id: email + "_privateKey", keyData: privateKeyData });
    privateKeyAddRequest.onerror = (event) => {
      console.error('Error storing private key:', event);
    };

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log('Key pair stored');
        resolve(true);
      };
      transaction.onerror = (event) => {
        console.error('Error storing key pair:', event);
        reject(event);
      };
    });
  } catch (error) {
    console.error('Error in storeKeyPair:', error);
    throw error;
  }
}

// Retrieve key pair from IndexedDB
export async function retrieveKeyPair(email) {
  const normalisedEmail = email.toLowerCase();
  const db = await openIndexedDB();
  const transaction = db.transaction(storeName, "readonly");
  const keyStore = transaction.objectStore(storeName);

  const publicKeyRequest = keyStore.get(normalisedEmail + "_publicKey");
  const privateKeyRequest = keyStore.get(normalisedEmail + "_privateKey");

  transaction.onerror = (event) => {
    console.log('Transaction error:', event);
  };
  transaction.onabort = (event) => {
    console.log('Transaction aborted:', event);
  };

  return new Promise(async (resolve, reject) => {
    transaction.oncomplete = async () => {
      if (publicKeyRequest.result && privateKeyRequest.result) {
        const publicKey = await importPublicKey(publicKeyRequest.result.keyData);
        const privateKey = await importPrivateKey(privateKeyRequest.result.keyData)
        resolve({ publicKey, privateKey });
      } else {
        reject('Key pair not found in IndexedDB');
      }
    };
    transaction.onerror = (event) => reject(event);
  });
}



export async function removeUserKeysFromIndexedDB(email) {
  try {
    const db = await openIndexedDB();
    const transaction = db.transaction(storeName, "readwrite");
    const keyStore = transaction.objectStore(storeName);

    const publicKeyDeleteRequest = keyStore.delete(email + "_publicKey");
    publicKeyDeleteRequest.onerror = (event) => {
      console.error("Error deleting public key:", event);
    };

    const privateKeyDeleteRequest = keyStore.delete(email + "_privateKey");
    privateKeyDeleteRequest.onerror = (event) => {
      console.error("Error deleting private key:", event);
    };

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log("User keys deleted from IndexedDB");
        resolve(true);
      };
      transaction.onerror = (event) => {
        console.error("Error deleting user keys from IndexedDB:", event);
        reject(event);
      };
    });
  } catch (error) {
    console.error("Error in removeUserKeysFromIndexedDB:", error);
    throw error;
  }
}

// Get public key
export async function getPublicKey(email) {
  if (!isValidEmail(email)) {
    console.error('Invalid email address');
    return null;
  }
  let publicKey;
  if (await emailExists(email)) {
    try {
      const keyPair = await retrieveKeyPair(email);
      publicKey = keyPair.publicKey;
    } catch (error) {
      console.error('Error while retrieving key pair:', error);
      throw error;
    }
  } else {
    const keyPair = await generateKeyPair();
    await storeKeyPair(email, keyPair);
    publicKey = keyPair.publicKey;
  }
  const exported = await exportPublicKey(publicKey);
  return exported;
}

// Get private key
export async function getPrivateKey(email) {
  if (!isValidEmail(email)) {
    console.error('Invalid email address');
    return null;
  }
  let privateKey;
  if (await emailExists(email)) {
    try {
      const keyPair = await retrieveKeyPair(email);
      privateKey = keyPair.privateKey;
    } catch (error) {
      console.error('Error while retrieving key pair:', error);
      throw error;
    }
  } else {
    const keyPair = await generateKeyPair();
    await storeKeyPair(email, keyPair);
    privateKey = keyPair.privateKey;
  }
  return privateKey;
}
