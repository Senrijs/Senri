import { app } from "../shared/app.ts";
import { serve } from "../../adapters/node/index.ts";

serve(app, { port: 3000 });