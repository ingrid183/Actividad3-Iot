"""API del dashboard: GET /valuesensor lee DynamoDB y POST /actuator publica la orden del LED.

Configurar en Lambda (Configuracion -> Variables de entorno):
  TABLE_NAME     nombre de la tabla de DynamoDB donde la regla de IoT guarda las lecturas.
  DEVICE_ID      dispositivo por defecto (esp32_01).
  ACTUATOR_TOPIC topic que escucha la ESP32 (data/actuators).
  IOT_ENDPOINT   opcional: https://xxxx-ats.iot.us-east-1.amazonaws.com
El rol de la funcion necesita dynamodb:Scan sobre la tabla e iot:Publish sobre el topic.
"""
import json
import os
from decimal import Decimal

import boto3

TABLE = boto3.resource("dynamodb").Table(os.environ.get("TABLE_NAME", "valores-sensor-moviles"))
DEVICE_ID = os.environ.get("DEVICE_ID", "esp32_01")
ACTUATOR_TOPIC = os.environ.get("ACTUATOR_TOPIC", "data/actuators")
CORS = {"Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,x-api-key",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS"}
_iot = None


def response(status, body):
    return {"statusCode": status, "headers": {"Content-Type": "application/json", **CORS},
            "body": json.dumps(body, default=lambda v: float(v) if isinstance(v, Decimal) else str(v))}


def iot_client():
    # La publicacion debe ir al endpoint de datos ATS de la cuenta.
    global _iot
    if _iot is None:
        endpoint = os.environ.get("IOT_ENDPOINT") or "https://" + boto3.client("iot").describe_endpoint(
            endpointType="iot:Data-ATS")["endpointAddress"]
        _iot = boto3.client("iot-data", endpoint_url=endpoint)
    return _iot


def flatten(item):
    # La accion DynamoDB (v1) de IoT guarda el mensaje dentro de "payload"; la v2 lo guarda plano.
    payload = item.get("payload")
    if isinstance(payload, dict):
        return {**{k: v for k, v in item.items() if k != "payload"}, **payload}
    return item


def readings(params):
    device = params.get("device_id") or DEVICE_ID
    limit = min(int(params.get("limit") or 500), 2000)
    items, kwargs = [], {}
    while True:
        page = TABLE.scan(**kwargs)
        items += [flatten(i) for i in page["Items"]]
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    items = [i for i in items if i.get("device_id", device) == device]
    items.sort(key=lambda i: float(i.get("timestamp", 0)), reverse=True)
    return response(200, {"items": items[:limit]})


def actuator(body):
    try:
        message = json.loads(body or "{}").get("message")
    except ValueError:
        message = None
    if message not in ("ON", "OFF"):
        return response(400, {"error": 'Enviar {"message": "ON"} o {"message": "OFF"}'})
    iot_client().publish(topic=ACTUATOR_TOPIC, qos=1, payload=json.dumps({"message": message}))
    return response(200, {"published": True, "topic": ACTUATOR_TOPIC, "message": message})


def lambda_handler(event, context):
    method = event.get("httpMethod") or event.get("requestContext", {}).get("http", {}).get("method", "GET")
    path = event.get("resource") or event.get("rawPath") or ""
    if method == "OPTIONS":
        return response(200, {})
    if method == "POST" and path.rstrip("/").endswith("/actuator"):
        return actuator(event.get("body"))
    if method == "GET":
        return readings(event.get("queryStringParameters") or {})
    return response(404, {"error": f"Ruta no soportada: {method} {path}"})
