import http from "k6/http";
import { sleep } from "k6";

export const options = {
  vus: 50,
  duration: "30s",
};

export default function () {
  const url = "http://localhost:3000/api/chat";

  const payload = JSON.stringify({
    message: "Explain artificial intelligence in simple terms"
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
    },
  };

  http.post(url, payload, params);

  sleep(1);
}