from .util import fallback_name


def render(name: str) -> str:
    safe_name = fallback_name(name)
    try:
        template = t"hello {safe_name}"
        return str(template)
    except ValueError, TypeError:
        return "hello world"


if __name__ == "__main__":
    print(render("world"))
