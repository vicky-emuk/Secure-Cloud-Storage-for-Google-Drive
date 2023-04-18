import os
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from flask import session

# Set scopes
SCOPES = ['https://www.googleapis.com/auth/drive', 'openid', 'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/contacts']


def creds_to_dict(creds):
    return {'token': creds.token,
            'refresh_token': creds.refresh_token,
            'token_uri': creds.token_uri,
            'client_id': creds.client_id,
            'client_secret': creds.client_secret,
            'scopes': creds.scopes}


def authenticate_user(code=None, creds=None):
    # Load credentials from the session
    creds_dict = session.get('credentials')
    creds = Credentials.from_authorized_user_info(
        info=creds_dict) if creds_dict else None
    # If no valid credentials then, log in
    if creds is None or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        elif code:
            secret_file_path = os.path.join(os.path.dirname(
                os.path.abspath(__file__)), "..", "secret.json")
            flow = InstalledAppFlow.from_client_secrets_file(
                secret_file_path, SCOPES)
            flow.redirect_uri = f"http://localhost:5000/auth_result"
            flow.fetch_token(code=code)
            creds = flow.credentials
        else:
            return None
        # Save credentials to the session
        session['credentials'] = creds_to_dict(creds)

    return creds


def get_user_info(creds):
    people_service = build('people', 'v1', credentials=creds)
    profile = people_service.people().get(resourceName='people/me',
                                          personFields='emailAddresses,names').execute()
    name = profile.get('names', [])[0].get('displayName')
    email = profile.get('emailAddresses', [])[0].get('value')
    return name, email
