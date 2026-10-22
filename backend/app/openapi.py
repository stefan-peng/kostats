"""Export API contracts without starting a server or reading application data."""
import json

from .main import app

if __name__ == '__main__':
    print(json.dumps(app.openapi(), sort_keys=True))
