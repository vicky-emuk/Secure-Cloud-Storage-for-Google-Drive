import { encryptAndUploadFile, downloadAndDecryptFile, arrayBufferToBase64 } from './crypto.js';
import { exportPublicKey, generateKeyPair, storeKeyPair, isValidEmail, userExists, removeUserKeysFromIndexedDB } from './key_management.js';

let currentPage = 0;

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

async function displayFileList(searchQuery = '', page = 1) {
    try {
        const response = await fetch('/api/list_files');
        if (response.ok) {
            const files = await response.json();

            // Filter files based on searchQuery
            const filteredFiles = files.filter(file => file.name.toLowerCase().includes(searchQuery.toLowerCase()));

            // Sort files by createdTime in descending order (most recent first)
            filteredFiles.sort((a, b) => b.createdTime.localeCompare(a.createdTime));

            // Calculate start and end indices for slicing
            const filesPerPage = 4;
            const startIndex = (page - 1) * filesPerPage;
            const endIndex = startIndex + filesPerPage;

            // Display files for the current page
            const filesToDisplay = filteredFiles.slice(startIndex, endIndex);

            const fileList = document.getElementById('file-list');
            fileList.innerHTML = '';

            for (const file of filesToDisplay) {
                const row = document.createElement('tr');

                const nameCell = document.createElement('td');
                nameCell.textContent = file.name;
                row.appendChild(nameCell);

                const uploaderCell = document.createElement('td');
                uploaderCell.textContent = file.uploader;
                row.appendChild(uploaderCell);

                const actionsCell = document.createElement('td');
                const downloadBtn = document.createElement('button');
                downloadBtn.classList.add('btn', 'btn-primary', 'me-2');
                downloadBtn.textContent = 'Download';
                downloadBtn.onclick = async () => {
                    try {
                        const email = document.getElementById('user-email').value;
                        await downloadAndDecryptFile(file.id, file.name, email);
                    } catch (error) {
                        alert(`Failed to download and decrypt the file: ${error.message}`);
                    }
                };
                actionsCell.appendChild(downloadBtn);

                const deleteBtn = document.createElement('button');
                deleteBtn.classList.add('btn', 'btn-danger');
                deleteBtn.textContent = 'Delete';
                deleteBtn.onclick = async () => {
                    try {
                        await deleteFile(file.id);
                        displayFileList();
                    } catch (error) {
                        alert(`Failed to delete the file: ${error.message}`);
                    }
                };
                actionsCell.appendChild(deleteBtn);

                row.appendChild(actionsCell);
                fileList.appendChild(row);
            }
            // Update the current page display
            const totalPages = Math.max(1, Math.ceil(filteredFiles.length / filesPerPage));
            const currentPageDisplay = document.getElementById('current-page');
            currentPageDisplay.textContent = `Page ${Math.min(page, totalPages)} of ${totalPages}`;

            // Update the currentPage variable
            currentPage = page;
        } else {
            const data = await response.json();
            throw new Error(data.message || 'Failed to fetch file list');
        }
    } catch (error) {
        alert(`Failed to fetch file list: ${error.message}`);
    }
}

const debouncedDisplayFileList = debounce((searchQuery) => {
    displayFileList(searchQuery);
}, 300);

async function handleSearchInput(event) {
    const searchQuery = event.target.value;
    debouncedDisplayFileList(searchQuery);
}

async function uploadFile(event) {
    event.preventDefault();

    const fileInput = document.getElementById('file');
    const file = fileInput.files[0];

    if (!file) {
        alert('Please select a file to upload');
        return;
    }
    const email = document.getElementById('user-email').value;

    try {
        await encryptAndUploadFile(file, email);
        alert('File uploaded successfully');
        displayFileList();
        fileInput.value = '';
    } catch (error) {
        alert(`Failed to upload the file: ${error.message}`);
    }
}

async function deleteFile(fileId) {
    const response = await fetch(`/api/delete_file`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileId }),
    });

    if (response.ok) {
        return;
    } else {
        const data = await response.json();
        throw new Error(data.message || 'Failed to delete the file')
    }
}

async function getUsers() {
    const response = await fetch('/api/get_users');
    if (response.ok) {
        const users = await response.json();
        return users;
    } else {
        const data = await response.json();
        throw new Error(data.message || 'Failed to fetch users');
    }
}

async function displayUsers() {
    const userList = document.getElementById('user-list');
    const users = await getUsers();
    userList.innerHTML = '';

    users.forEach((user) => {
        const row = document.createElement('tr');

        const nameCell = document.createElement('td');
        nameCell.textContent = user.email;
        row.appendChild(nameCell);

        const actionsCell = document.createElement('td');
        const removeBtn = document.createElement('button');
        removeBtn.classList.add('btn', 'btn-danger');
        removeBtn.textContent = 'Remove';
        removeBtn.onclick = () => {
            removeUserFromGroup(user.email);
            displayUsers();
        };
        actionsCell.appendChild(removeBtn);
        row.appendChild(actionsCell);

        userList.appendChild(row);
    });
}

async function addUserToGroup() {
    console.log('addUserToGroup called')
    const email = prompt('Enter the email address of the user you want to add:');
    if (!isValidEmail(email)) {
        alert('Invalid email address');
        return;
    }
    if (await userExists(email)) {
        alert('User already exists');
        return;
    }

    const myEmail = '{{ session["email"] }}';
    if (email == myEmail) {
        alert('You cannot add yourself to the group.')
    }
    try {
        // Generate key pair for the new user
        const keyPair = await generateKeyPair();
        const publicKeyData = await exportPublicKey(keyPair.publicKey);
        const publicKeyB64 = arrayBufferToBase64(publicKeyData);
        // Store the private key for the new user
        await storeKeyPair(email, keyPair);
        // Send the email and public key to the server
        const response = await fetch('/api/add_user', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, public_key: publicKeyB64 }),
        });

        const data = await response.json();

        if (response.ok) {
            alert(data.message);
            displayUsers();
        } else {
            throw new Error(data.message || 'Failed to add user');
        }
    } catch (error) {
        alert(`${error.message}`);
    }
}

async function removeUserFromGroup(email) {
    try {
        const response = await fetch('/api/remove_user', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email }),
        });

        if (response.ok) {
            await removeUserKeysFromIndexedDB(email);
            alert('User removed successfully');
            displayUsers();
        } else {
            const data = await response.json();
            throw new Error(data.message || 'Failed to remove user');
        }
    } catch (error) {
        alert(`Failed to remove user: ${error.message}`);
    }
}

async function logout() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST',
        });

        if (response.ok) {
            window.location.href = '/';
        } else {
            const data = await response.json();
            throw new Error(data.message || 'Failed to log out');
        }
    } catch (error) {
        alert(`Failed to log out: ${error.message}`);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    displayFileList();
    displayUsers();

    const uploadForm = document.getElementById('upload-btn');
    uploadForm.addEventListener('submit', uploadFile);

    const addUserBtn = document.getElementById('add-user-btn');
    addUserBtn.addEventListener('click', () => {
        addUserToGroup();
    });

    const logoutBtn = document.getElementById('logout-btn');
    logoutBtn.addEventListener('click', logout);

    const searchFilesInput = document.getElementById('search-files');
    searchFilesInput.addEventListener('input', handleSearchInput);

    const prevPageBtn = document.getElementById('prev-page-btn');
    prevPageBtn.addEventListener('click', () => {
        currentPage = Math.max(1, currentPage - 1);
        displayFileList('', currentPage);
    });

    const nextPageBtn = document.getElementById('next-page-btn');
    nextPageBtn.addEventListener('click', () => {
        currentPage++;
        displayFileList('', currentPage);
    });

    const pageNumberButtons = document.querySelectorAll('.page-number-btn');
    pageNumberButtons.forEach(btn => {
        btn.addEventListener('click', (event) => {
            currentPage = parseInt(event.target.textContent);
            displayFileList('', currentPage);
        });
    });
});

