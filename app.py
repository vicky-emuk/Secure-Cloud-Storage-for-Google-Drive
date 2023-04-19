from flask import Flask, request, redirect, url_for, session, render_template, jsonify
from werkzeug.utils import secure_filename
from src.google_auth import authenticate_user, get_user_info, creds_to_dict
from src.drive import download, upload, list_files, delete_file
from src.user_management import add_user_to_group, remove_user_from_group, is_user_in_group, get_group_members, get_group_members_public_keys
from google_auth_oauthlib.flow import InstalledAppFlow
from config import SECRET_KEY
import os, json, base64

app = Flask(__name__)
app.secret_key = SECRET_KEY

# Set scopes
SCOPES = ['https://www.googleapis.com/auth/drive', 'openid', 'https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/contacts']
    
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/login')
def login():
    creds = authenticate_user()
    if creds is None:
        flow = InstalledAppFlow.from_client_secrets_file(
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "secret.json"), SCOPES)
        flow.redirect_uri = f"http://localhost:5000/auth_result"
        authorization_url, _ = flow.authorization_url(prompt='consent', access_type='offline')
        return redirect(authorization_url)
    else:
        return redirect('/dashboard')
    
@app.route('/auth_result')
def auth_result():
    code = request.args.get('code')
    creds = authenticate_user(code)
    _, email = get_user_info(creds)
    session['credentials'] = creds_to_dict(creds)
    session['email'] = email
    return redirect(url_for('dashboard'))

@app.route('/dashboard')
def dashboard():
    creds = authenticate_user(creds=session.get('credentials'))
    files = list_files()
    members = get_group_members()
    name, _ = get_user_info(creds)
    if files is not None:
        return render_template('dashboard.html', files=files, members=members, username=name)
    else:
        return jsonify({'message': 'Failed to fetch files and members.'}), 400


@app.route('/download', methods=['POST'])
def download_file():
    email = session.get('email')
    if not is_user_in_group(email):
        return jsonify({'message': 'You are not authorized to download this file.'}), 403

    data = request.get_json()
    file_id = data['file_id']
    file_name = data['file_name']
    response_data = download(file_id, file_name)
    if response_data is not None:
        return jsonify({
            'fileContent': response_data['fileContent'],
            'iv': response_data['iv'],
            'uploader': response_data['uploader'],
            'encryptedAesKeys': [response_data['encryptedAesKeys']]
        })
    else:
        return jsonify({'message': 'Failed to download file.'}), 400

@app.route('/upload', methods=['POST'])
def upload_file():
    email = session.get('email')
    if not is_user_in_group(email):
        return jsonify({'message': 'You are not authorized to upload files.'}), 403

    if 'file' not in request.files:
        return jsonify({'message': 'No file selected.'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'message': 'No file selected.'}), 400

    encrypted_data_base64 = request.form.get('encryptedData')
    iv_base64 = request.form.get('iv')
    encrypted_aes_keys = json.loads(request.form.get('encryptedAesKeys'))
    original_file = request.files['file']
    filename = secure_filename(original_file.filename)
    
    if not encrypted_data_base64 or not iv_base64 or not encrypted_aes_keys or not filename:
        return jsonify({'message': 'Missing required data.'}), 400

    # Save the encrypted file to the 'uploads' directory
    encrypted_data = base64.b64decode(encrypted_data_base64)
    encrypted_file_path = os.path.join('uploads', filename)
    with open(encrypted_file_path, 'wb') as f:
        f.write(encrypted_data)

    # Upload the encrypted file to Google Drive
    uploaded_file = upload(encrypted_file_path, filename, iv_base64, encrypted_aes_keys, email)

    # Remove the encrypted file from the 'uploads' directory
    os.remove(encrypted_file_path)

    if uploaded_file is not None:
        return jsonify({'message': 'File uploaded successfully.'}), 200
    else:
        return jsonify({'message': 'Failed to upload file.'}), 400

@app.route('/api/delete_file', methods=['POST'])
def delete_file_route():
    file_id = request.json.get('fileId')
    try:
        delete_file(file_id)
        return jsonify({'message': 'File deleted successfully.'}), 200
    except Exception as e:
        print(e)
        return jsonify({'message': 'Failed to delete the file.'}), 400

@app.route('/api/user_exists', methods=['POST'])
def user_exists():
    data = request.get_json()
    email = data['email']
    exists = is_user_in_group(email)
    return jsonify(exists=exists)

@app.route('/api/add_user', methods=['POST'])
def add_user():
    try:
        data = request.get_json()
        email = data['email']
        public_key = data['public_key']  
        creds = authenticate_user(creds=session.get('credentials'))
        if creds is None:
            return jsonify({'success': False, 'message': 'Error: Could not get user credentials.'}), 500
        if add_user_to_group(email, public_key):
            return jsonify({'success': True, 'message': 'User added to the group successfully.'}), 200
        else:
            return jsonify({'success': False, 'message': 'User already added to the group.'}), 400
    except Exception as e:
        print(f"Error in add_user: {e}")
        return jsonify({'success': False, 'message': f"Error in add_user: {e}"}), 500

@app.route('/api/remove_user', methods=['POST'])
def remove_user():
    data = request.get_json()
    email = data['email']
    if remove_user_from_group(email):
        return jsonify({'message': 'User removed from the group successfully.'}), 200
    else:
        return jsonify({'message': 'Failed to remove user from the group.'}), 400

@app.route('/api/get_group_members_public_keys', methods=['GET'])
def get_group_members_public_keys_endpoint():
    public_keys = get_group_members_public_keys()
    return jsonify(publicKeys=public_keys)

@app.route('/api/list_files', methods=['GET'])
def api_list_files():
    files = list_files()
    if files is not None:
        for file in files:
            file['uploader'] = file['appProperties'].get('uploader', '')
        return jsonify(files)
    else:
        return jsonify(error='Failed to fetch files'), 404
    

@app.route('/api/get_users', methods=['GET'])
def api_get_users():
    users = get_group_members()
    if users is not None:
        return jsonify([{'email': user} for user in users])
    else:
        return jsonify(error='Failed to fetch users'), 404

@app.route('/api/logout', methods=['POST'])
def logout():
    if 'credentials' in session:
        session.pop('credentials', None)
    return jsonify({'message': 'Logged out successfully.'})

if __name__ == '__main__':
    app.run(debug=True)