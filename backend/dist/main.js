"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
async function bootstrap() {
    console.log('BOT TOKEN:', process.env.SLACK_BOT_TOKEN);
    console.log('SIGNING SECRET:', process.env.SLACK_SIGNING_SECRET);
    console.log('APP TOKEN:', process.env.SLACK_APP_TOKEN);
    console.log('PORT:', process.env.PORT);
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.enableCors();
    const port = process.env.PORT || 3000;
    await app.listen(port);
    console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
//# sourceMappingURL=main.js.map