"""Python test program for integration tests.

Provides debuggable functions with typed local variables
(int, str, list, dict) for breakpoint and variable inspection testing.
"""


def calculate(a: int, b: int) -> dict:
    total: int = a + b
    product: int = a * b
    result: dict = {"total": total, "product": product}
    return result


def process_data(items: list) -> dict:
    count: int = len(items)
    first: int = items[0]
    doubled: list = [x * 2 for x in items]
    summary: str = f"{count} items, first={first}"
    return {"count": count, "first": first, "doubled": doubled, "summary": summary}


def main() -> None:
    greeting: str = "hello"
    value: int = 42
    data: list = [1, 2, 3, 4, 5]

    calc_result: dict = calculate(10, 20)
    processed: dict = process_data(data)

    print(greeting, value, calc_result, processed)


if __name__ == "__main__":
    main()
