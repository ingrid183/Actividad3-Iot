#include <DHT.h>
#include <DHT_U.h>
#include <WiFiClientSecure.h>
#include <WiFi.h>
#include "credentials.h"
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>

#define dhtpin 5
#define DHTTYPE DHT11
#define led 2  // LED azul integrado de la ESP32 clasica

#define monitoreo_topic "esp32-datos-moviles" // Topic que escucha la regla save_data_dynamodb
#define suscribe_topic "data/actuators"       // Ordenes del dashboard: {"message":"ON"|"OFF"}
#define PUBLISH_INTERVAL_MS 10000
// Control automatico con histeresis: enciende al subir a TEMP_ON y apaga al bajar a TEMP_OFF.
#define TEMP_ON 30.0
#define TEMP_OFF 29.0

WiFiClientSecure client;
PubSubClient esp32(client);
DHT dht(dhtpin, DHTTYPE);
unsigned long lastPublish = 0;
int tempZone = -1;  // -1 sin lectura, 0 bajo el limite, 1 sobre el limite

// Solo actua cuando la temperatura cruza un limite, para no anular las ordenes del dashboard.
void autoControl(float t)
{
  int zone = tempZone;
  if (t >= TEMP_ON) zone = 1;
  else if (t <= TEMP_OFF) zone = 0;
  else if (zone == -1) zone = 0;
  if (zone == tempZone) return;
  bool firstReading = tempZone == -1;
  tempZone = zone;
  if (firstReading && zone == 0) return;  // Al arrancar con temperatura normal no se toca el LED
  digitalWrite(led, zone ? HIGH : LOW);
  Serial.println(zone ? "Temperatura alta: LED turned ON (automatico)"
                      : "Temperatura normal: LED turned OFF (automatico)");
}

void messageHandler(char* topic, byte* payload, unsigned int length)
{
  Serial.print("incoming: ");
  Serial.println(topic);

  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) {
    Serial.println("Mensaje no es JSON valido");
    return;
  }
  const char* message = doc["message"] | "";

  if (strcmp(message, "ON") == 0) {
    digitalWrite(led, HIGH);
    Serial.println("LED turned ON (dashboard)");
  } else if (strcmp(message, "OFF") == 0) {
    digitalWrite(led, LOW);
    Serial.println("LED turned OFF (dashboard)");
  } else {
    Serial.println("Unknown command received");
  }
}

void connectWiFi()
{
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("WiFi connected, IP: ");
  Serial.println(WiFi.localIP());
}

void connectAWS()
{
  // Siempre con el nombre del Thing: la politica de AWS IoT solo autoriza ese client ID.
  while (!esp32.connected()) {
    connectWiFi();
    Serial.println("Connecting to AWS IoT...");
    if (esp32.connect(THINGSNAME)) {
      esp32.subscribe(suscribe_topic);  // Volver a suscribirse en cada reconexion
      Serial.println("AWS IoT Connected!");
    } else {
      Serial.print("Failed, rc=");
      Serial.print(esp32.state());
      Serial.println(" Try again in 5 seconds");
      delay(5000);
    }
  }
}

void publishMessage(float h, float t)
{
  JsonDocument doc;
  doc["timestamp"] = (long)time(nullptr);  // Segundos UTC, sincronizados por NTP
  doc["humidity"] = h;
  doc["temperature"] = t;
  doc["device_id"] = "esp32_01";

  char jsonBuffer[256];
  serializeJson(doc, jsonBuffer);
  if (esp32.publish(monitoreo_topic, jsonBuffer)) {
    Serial.print("Publicado: ");
    Serial.println(jsonBuffer);
  } else {
    Serial.println("No se pudo publicar");
  }
}

void setup()
{
  Serial.begin(9600);
  pinMode(led, OUTPUT);
  digitalWrite(led, LOW);
  dht.begin();

  connectWiFi();
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  Serial.print("Sincronizando hora");
  while (time(nullptr) < 1700000000) {  // Evita enviar lecturas con fecha de 1970
    delay(500);
    Serial.print(".");
  }
  Serial.println(" OK");

  client.setCACert(AWS_CERT_CA);
  client.setCertificate(AWS_CERT_CRT);
  client.setPrivateKey(AWS_CERT_PRIVATE);
  esp32.setServer(AWS_IoT_Endpoint, 8883);
  esp32.setCallback(messageHandler);
  connectAWS();
}

void loop()
{
  if (!esp32.connected()) connectAWS();
  esp32.loop();  // Atiende las ordenes del LED de inmediato

  if (millis() - lastPublish < PUBLISH_INTERVAL_MS) return;
  lastPublish = millis();

  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (isnan(h) || isnan(t)) {
    Serial.println("Lectura DHT invalida: revisar DATA en GPIO 5, 3.3V y GND");
    return;
  }
  Serial.printf("Humidity: %.1f%%  Temperature: %.1f C\n", h, t);
  autoControl(t);
  publishMessage(h, t);
}
