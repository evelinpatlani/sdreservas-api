import { app } from "./app.js";
import { env } from "./config/env.js";

app.listen(env.PORT, () => {
  console.log(`SDReservas API escuchando en el puerto ${env.PORT}`);
});
