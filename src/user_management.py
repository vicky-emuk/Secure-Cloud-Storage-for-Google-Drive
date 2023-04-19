import sqlite3

DB_NAME = "secure_cloud_storage.db"


def init_db():
    with sqlite3.connect(DB_NAME) as conn:
        conn = sqlite3.connect(DB_NAME)
        c = conn.cursor()
        c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            public_key TEXT NOT NULL
        )
        """)
        conn.commit()


def add_user_to_group(email, public_key):
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute("INSERT OR IGNORE INTO users (email, public_key) VALUES (?, ?)",
              (email, public_key))
    success = c.rowcount > 0
    conn.commit()
    conn.close()
    return success


def remove_user_from_group(email):
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute("DELETE FROM users WHERE email=?", (email,))
    rows_affected = c.rowcount
    conn.commit()
    conn.close()
    return rows_affected > 0


def is_user_in_group(email):
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute("SELECT email FROM users WHERE email=?", (email,))
    result = c.fetchone()
    conn.close()
    return result is not None


def get_group_members():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute("SELECT email FROM users")
    group_members = [row[0] for row in c.fetchall()]
    conn.close()
    return group_members


def get_group_members_public_keys():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute("SELECT email, public_key FROM users")
    group_members_public_keys = [
        {"email": row[0], "public_key": row[1]} for row in c.fetchall()]
    conn.close()
    return group_members_public_keys


init_db()  # Initialize the database when the module is imported
