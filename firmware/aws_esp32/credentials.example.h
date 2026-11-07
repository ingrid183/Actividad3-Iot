// Copiar como credentials.h y completar. credentials.h y los .pem nunca se suben a GitHub.
#ifndef credentials
#define credentials
#include <pgmspace.h>

#define THINGSNAME "NOMBRE_DEL_THING"

const char ssid[] = "RED_WIFI_2_4_GHZ";
const char password[] = "CLAVE_WIFI";

const char AWS_IoT_Endpoint[] = "xxxxxxxxxxxx-ats.iot.us-east-1.amazonaws.com";

// AmazonRootCA1.pem
static const char AWS_CERT_CA[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----
)EOF";

// xxxx-certificate.pem.crt
static const char AWS_CERT_CRT[] PROGMEM = R"KEY(
-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----
)KEY";

// xxxx-private.pem.key
static const char AWS_CERT_PRIVATE[] PROGMEM = R"KEY(
-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----
)KEY";

#endif
