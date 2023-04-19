import { importPublicKey, getPrivateKey } from './key_management.js';

// Utility function to convert ArrayBuffer to Base64
export function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
function sanitiseBase64(base64) {
    return base64.replace(/[\s\n]+/g, '');
  }
  

// Utility function to convert Base64 to ArrayBuffer
function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return buffer;
}

// Generate a random AES key
async function generateAesKey() {
    const key = await crypto.subtle.generateKey(
        {
            name: 'AES-GCM',
            length: 256,
        },
        true,
        ['encrypt', 'decrypt']
    );
    return key;
}

// Get the group members' public keys
async function getGroupMembersPublicKeys() {
    const response = await fetch('/api/get_group_members_public_keys', {
        method: 'GET',
    });
    if (response.ok) {
        const data = await response.json();
        const importedPublicKeys = await Promise.all(
            data.publicKeys.map(async (keyObj) => {
                const publicKeyArrayBuffer = base64ToArrayBuffer(keyObj.public_key);
                const publicKey = await importPublicKey(publicKeyArrayBuffer);
                return {
                    email: keyObj.email,
                    publicKey: publicKey,
                };
            })
        );
        return importedPublicKeys;
    } else {
        return [];
    }
}

// Encrypt the AES key with the public keys of each group member
async function encryptAesKeyForGroupMembers(aesKey, groupMembersPublicKeys) {
    const encryptedAesKeys = await Promise.all(
        groupMembersPublicKeys.map(async (member) => {
            const aesKeyRaw = await crypto.subtle.exportKey('raw', aesKey);
            const encryptedAesKey = await window.crypto.subtle.encrypt(
                {
                    name: 'RSA-OAEP',
                },
                member.publicKey,
                aesKeyRaw
            );
            return arrayBufferToBase64(encryptedAesKey);
        })
    );
    return encryptedAesKeys;
}

// Upload the encrypted file and encrypted AES keys to the server
async function uploadEncryptedFile(encryptedFile, encryptedAesKeys, email, originalFile) {
    const formData = new FormData();
    formData.append('email', email);
    formData.append('file', originalFile);
    formData.append('iv', encryptedFile.iv);
    formData.append('encryptedData', encryptedFile.encryptedData);
    formData.append('encryptedAesKeys', JSON.stringify(encryptedAesKeys));

    const response = await fetch('/upload', {
        method: 'POST',
        body: formData,
    });

    return response.ok;
}

// Decrypt the AES key with the user's private key
async function decryptAesKey(encryptedAesKeys, privateKey) {
    const sanitisedEncryptedAesKey = sanitiseBase64(encryptedAesKeys[0]);
    const encryptedAesKeyArrayBuffer = base64ToArrayBuffer(sanitisedEncryptedAesKey);
    const decryptedAesKeyRaw = await crypto.subtle.decrypt(
      {
        name: "RSA-OAEP",
      },
      privateKey,
      encryptedAesKeyArrayBuffer
    );
    const decryptedAesKey = await crypto.subtle.importKey(
      "raw",
      decryptedAesKeyRaw,
      {
        name: "AES-GCM",
        length: 256,
      },
      true,
      ["encrypt", "decrypt"]
    );
    return decryptedAesKey;
  }
  

// Save the decrypted file
function saveFile(decryptedFile, fileName) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(decryptedFile);
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
}

async function encryptFile(file, aesKey) {
    const fileData = await file.arrayBuffer();
    const fileDataView = new Uint8Array(fileData);

    // Encrypt file data using the generated AES-GCM key
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedData = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv,
        },
        aesKey,
        fileDataView
    );
    return {
        iv: arrayBufferToBase64(iv),
        encryptedData: arrayBufferToBase64(encryptedData),
    };
}

async function decryptFile(encryptedFile, aesKey, iv) {
    const encryptedData = base64ToArrayBuffer(encryptedFile.encryptedData);
    const ivArrayBuffer = base64ToArrayBuffer(iv);

    // Decrypt file data using the unwrapped AES-GCM key
    const decryptedData = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: ivArrayBuffer,
        },
        aesKey,
        encryptedData
    );
    return new Blob([decryptedData]);
}

export async function encryptAndUploadFile(file, email) {
    // Generate a random AES key
    const aesKey = await generateAesKey();
    // Encrypt the file with the AES key
    const encryptedFile = await encryptFile(file, aesKey);
    // Encrypt the AES key with the public key of each group member
    const groupMembersPublicKeys = await getGroupMembersPublicKeys();
    const encryptedAesKeys = await encryptAesKeyForGroupMembers(aesKey, groupMembersPublicKeys);

    // Upload the encrypted file and encrypted AES keys to the server
    await uploadEncryptedFile(encryptedFile, encryptedAesKeys, email, file);
}

export async function downloadAndDecryptFile(fileId, fileName, email) {
    try {
        const response = await fetch('/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                file_id: fileId,
                file_name: fileName,
            }),
        });

        if (response.ok) {
            const data = await response.json();

            if (data) {
                const { fileContent, iv, encryptedAesKeys } = data;
                // Decrypt the AES key with the user's private key
                const privateKey = await getPrivateKey(email);
                console.log('Private key:', privateKey);
                const aesKey = await decryptAesKey(encryptedAesKeys, privateKey);

                // Get file content
                const encryptedFile = { encryptedData: fileContent };
                // Decrypt the file with the decrypted AES key
                const decryptedFile = await decryptFile(encryptedFile, aesKey, iv);
                // Save the decrypted file
                saveFile(decryptedFile, fileName);
            } else {
                console.error('Failed to download and decrypt the file: No data received.');
                throw new Error('No data received');
            }
        } else {
            const data = await response.json();
            console.error(`Failed to download file: ${data.message}`);
            throw new Error(data.message || 'Failed to download file');
        }
    } catch (error) {
        console.error('Failed to download and decrypt the file:', error);
        throw error;
    }
}

