import { importPublicKey, retrieveKeyPair } from './key_management.js';

// Utility function to convert ArrayBuffer to Base64
export function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
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


// Download the encrypted file and encrypted AES keys from the server
async function downloadEncryptedFile(fileId, fileName, email) {
    const response = await fetch(`/download`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            email: email,
            file_id: fileId,
            file_name: fileName,
        }),
    }); 

    if (response.ok) {
        const data = await response.json();
        console.log("JSON Data:", data);
        return {
            encryptedFile: {
                iv: data.iv,
                encryptedData: data.fileContent,
            },
            encryptedAesKeys: JSON.parse(data.encryptedAesKeys),
            uploader: data.uploader,
        };
    } else {
        return null;
    }
}

// Get the user's private key
async function getPrivateKey() {
    const { privateKey } = await retrieveKeyPair();
    return privateKey;
}

// Decrypt the AES key with the user's private key
async function decryptAesKey(encryptedAesKeys, privateKey) {
    const decryptedAesKey = await crypto.subtle.decrypt(
        {
            name: 'RSA-OAEP',
        },
        privateKey,
        base64ToArrayBuffer(encryptedAesKeys[0]) // Assuming the user's encrypted AES key is the first one in the array
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

async function decryptFile(encryptedFile, privateKey, encryptedWrappedKey) {
    const encryptedData = base64ToArrayBuffer(encryptedFile.encryptedData);
    const wrappedKey = base64ToArrayBuffer(encryptedWrappedKey);
    const iv = base64ToArrayBuffer(encryptedFile.iv);

    // Unwrap the AES-GCM key using the provided private key
    const aesKey = await crypto.subtle.unwrapKey(
        'raw',
        wrappedKey,
        privateKey,
        {
            name: 'RSA-OAEP',
        },
        {
            name: 'AES-GCM',
            length: 256,
        },
        true,
        ['decrypt']
    );

    // Decrypt file data using the unwrapped AES-GCM key
    const decryptedData = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: iv,
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

    // Download the encrypted file and encrypted AES keys from the server
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
            const { fileContent, iv, uploader, encryptedAesKeys } = data;

            // Decrypt the AES key with the user's private key
            const privateKey = await getPrivateKey();
            const aesKey = await decryptAesKey(encryptedAesKeys, privateKey);

            // Convert encrypted file content from Base64 to ArrayBuffer
            const encryptedFile = base64ToArrayBuffer(fileContent);

            // Decrypt the file with the decrypted AES key
            const decryptedFile = await decryptFile(encryptedFile, aesKey, iv);

            // Save the decrypted file
            saveFile(decryptedFile, fileName);
        } else {
            console.error('Failed to download and decrypt the file.');
        }
    } else {
        const data = await response.json();
        throw new Error(data.message || 'Failed to download file');
    }
}
