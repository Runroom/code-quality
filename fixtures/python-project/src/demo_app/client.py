import httpx


def get_client() -> httpx.Client:
    return httpx.Client()
