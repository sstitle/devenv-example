from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def root():
    return {"message": "hello from devenv"}


@app.get("/items/{item_id}")
def get_item(item_id: int):
    return {"item_id": item_id}
