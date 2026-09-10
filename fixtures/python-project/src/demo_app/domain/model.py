from demo_app.infra import db


def load_model():
    return db.load()
