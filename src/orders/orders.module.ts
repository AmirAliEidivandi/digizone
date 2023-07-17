import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { UserRepository } from 'src/shared/repositories/user.repository';
import { ProductRepository } from 'src/shared/repositories/products.repository';
import { OrdersRepository } from 'src/shared/repositories/orders.repository';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from 'src/shared/middlewares/role.guard';
import { StripeModule } from 'nestjs-stripe';
import config from 'config';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductSchema, Products } from 'src/shared/schema/products';
import { License, LicenseSchema } from 'src/shared/schema/license';
import { UserSchema, Users } from 'src/shared/schema/users';
import { OrderSchema, Orders } from 'src/shared/schema/orders';
import { AuthMiddleware } from 'src/shared/middlewares/auth';

@Module({
  controllers: [OrdersController],
  providers: [
    OrdersService,
    UserRepository,
    ProductRepository,
    OrdersRepository,
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  imports: [
    StripeModule.forRoot({
      apiKey: config.get('stripe.secret_key'),
      apiVersion: '2022-11-15',
    }),
    MongooseModule.forFeature([{ name: Products.name, schema: ProductSchema }]),
    MongooseModule.forFeature([{ name: License.name, schema: LicenseSchema }]),
    MongooseModule.forFeature([{ name: Users.name, schema: UserSchema }]),
    MongooseModule.forFeature([{ name: Orders.name, schema: OrderSchema }]),
  ],
})
export class OrdersModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware)
      .exclude({
        path: `${config.get('appPrefix')}/orders/webhook`,
        method: RequestMethod.POST,
      })
      .forRoutes(OrdersController);
  }
}
