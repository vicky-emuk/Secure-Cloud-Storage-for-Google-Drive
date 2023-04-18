import io, base64
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from src.google_auth import authenticate_user
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload

_service = None


def get_drive_service():
    global _service
    if _service is None:
        # Authenticate user
        creds = authenticate_user()
        # Build Google Drive API client
        _service = build('drive', 'v3', credentials=creds)
    return _service


def download(file_id, file_name):
    try:
        # Get Google Drive API service
        service = get_drive_service()
        request = service.files().get_media(fileId=file_id)
        file_content = io.BytesIO()
        downloader = MediaIoBaseDownload(file_content, request)
        done = False
        while done is False:
            status, done = downloader.next_chunk()
            print(F"Download progress: {int(status.progress() * 100)}.")
        file_content.seek(0)
        file_content_base64 = base64.b64encode(file_content.read()).decode('utf-8')

        # Get appProperties (iv, encryptedAesKeys, uploader) from Google Drive API
        file_metadata = service.files().get(fileId=file_id, fields='appProperties, description').execute()
        app_properties = file_metadata.get('appProperties', {})
        encrypted_aes_keys = file_metadata.get('description', '')
        print(f"File metadata received: {file_metadata}, app_properties: {app_properties}, encrypted_keys: {encrypted_aes_keys}")

        return {
            'fileContent': file_content_base64,
            'fileName': file_name,
            'iv': app_properties.get('iv', ''),
            'uploader': app_properties.get('uploader', ''),
            'encryptedAesKeys': encrypted_aes_keys
        }

    except HttpError as error:
        print(f'An error has occurred: {error}')
        return None
    
def upload(file_path, file_name, iv_value, encrypted_aes_keys, email, folder_id=None):
    try:
        # Get Google Drive API service
        service = get_drive_service()
        # Check for existence
        query = f"name='{file_name}' and trashed = false"
        if folder_id:
            query += f" and '{folder_id}' in parents"
        results = service.files().list(
            q=query, fields='nextPageToken, files(id, name)').execute()
        items = results.get('files', [])
        if items:
            print(
                f"A file with the name '{file_name}' already exists in Google Drive.")
            return
        # Upload file to Google Drive API
        file_metadata = {
            'name': file_name,
            'description': encrypted_aes_keys,
            'appProperties': {
                'secure_cloud_storage': 'True',
                'iv': iv_value,
                'uploader': email
            }
        }

        media = MediaFileUpload(file_path, mimetype='application/octet-stream')
        file = service.files().create(body=file_metadata,
                                      media_body=media, fields='id, appProperties').execute()
        print(f"File created with appProperties: {file.get('appProperties', {})}")
    except HttpError as error:
        print(f'An error has occurred: {error}')
        file = None
    return file


def list_files():
    try:
        # Get Google Drive API service
        service = get_drive_service()
        query = "appProperties has { key='secure_cloud_storage' and value='True' }"
        results = service.files().list(q=query,
                                       fields="nextPageToken, files(id, name, mimeType, createdTime, appProperties)").execute()
        items = results.get('files', [])
        return items
    except HttpError as error:
        print(f'An error has occurred: {error}')
        return None


def delete_file(file_id):
    try:
        # Get Google Drive API service
        service = get_drive_service()
        service.files().delete(fileId=file_id).execute()
        print(f'File with ID {file_id} has been deleted.')
    except HttpError as error:
        print(f'An error has occurred: {error}')
        raise Exception("Failed to delete the file.")
