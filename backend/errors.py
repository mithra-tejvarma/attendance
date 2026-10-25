class ServiceError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def schema_error():
    return ServiceError(
        502,
        "upstream_schema",
        "CampX returned an unsupported response. Existing attendance has not been replaced.",
    )
