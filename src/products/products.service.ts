import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { Products } from 'src/shared/schema/products';
import { InjectStripe } from 'nestjs-stripe';
import Stripe from 'stripe';
import config from 'config';
import cloudinary from 'cloudinary';
import qs2m from 'qs-to-mongo';
import { ProductRepository } from 'src/shared/repositories/products.repository';
import { OrdersRepository } from 'src/shared/repositories/orders.repository';
import { GetProductQueryDto } from './dto/get-product-query.dto';
import { unlinkSync } from 'fs';
import { ProductSkuDto, ProductSkuDtoArr } from './dto/product-sku.dto';

@Injectable()
export class ProductsService {
  constructor(
    @Inject(ProductRepository) private readonly productDB: ProductRepository,
    @Inject(OrdersRepository) private readonly orderDB: OrdersRepository,
    @InjectStripe() private readonly stripeClient: Stripe,
  ) {
    cloudinary.v2.config({
      cloud_name: config.get('cloudinary.cloud_name'),
      api_key: config.get('cloudinary.api_key'),
      api_secret: config.get('cloudinary.api_secret'),
    });
  }

  /**
   * Create a new product in the database and Stripe.
   * @async
   * @param {CreateProductDto} createProductDto - An object containing the details of the product to create.
   * @returns {Promise<{ message: string; result: Products; success: boolean }>} - An object containing a message, the created product document and a success flag.
   * @throws {Error} - If an error occurs during the creation process.
   */
  async createProduct(
    createProductDto: CreateProductDto,
  ): Promise<{ message: string; result: Products; success: boolean }> {
    try {
      // create a product in stripe
      if (!createProductDto.stripeProductId) {
        const createdProductInStripe = await this.stripeClient.products.create({
          name: createProductDto.productName,
          description: createProductDto.description,
        });
        createProductDto.stripeProductId = createdProductInStripe.id;
      }

      const createdProductInDB = await this.productDB.create(createProductDto);
      return {
        message: 'Product created successfully',
        result: createdProductInDB,
        success: true,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Finds all the products that match the given query parameters in the database.
   * @async
   * @param query - An object containing the query parameters
   * @returns {Promise<{ message: string; result: { metadata: { skip: number; limit: number; total: number; pages: number; links: string[] }; products: Products[] }; success: boolean }>} - An object containing a message, an array of product documents and a success flag.
   * @throws {Error} - If an error occurs during the search process.
   */
  async findAllProducts(query: GetProductQueryDto) {
    try {
      let callForHomePage = false;
      if (query.homepage) {
        callForHomePage = true;
      }
      delete query.homepage;
      const { criteria, options, links } = qs2m(query);
      if (callForHomePage) {
        const products = await this.productDB.findProductWithGroupBy();
        return {
          message:
            products.length > 0
              ? 'Products fetched successfully'
              : 'No products found',
          result: products,
          success: true,
        };
      }
      const { totalProductCount, products } = await this.productDB.find(
        criteria,
        options,
      );
      return {
        message:
          products.length > 0
            ? 'Products fetched successfully'
            : 'No products found',
        result: {
          metadata: {
            skip: options.skip || 0,
            limit: options.limit || 10,
            total: totalProductCount,
            pages: options.limit
              ? Math.ceil(totalProductCount / options.limit)
              : 1,
            links: links('/', totalProductCount),
          },
          products,
        },
        success: true,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Finds a product by ID in the database and returns the product document and related products.
   * @async
   * @param {string} id - The ID of the product to find.
   * @returns {Promise<{ message: string; result: { product: Products; relatedProducts: Products[] }; success: boolean }>} An object containing a message, the product document and an array of related product documents, and a success flag.
   * @throws {Error} If the product does not exist or an error occurs during the search process.
   */
  async findOneProduct(id: string): Promise<{
    message: string;
    result: { product: Products; relatedProducts: Products[] };
    success: boolean;
  }> {
    try {
      const product: Products = await this.productDB.findOne({ _id: id });
      if (!product) {
        throw new Error('Product does not exist');
      }
      const relatedProducts: Products[] =
        await this.productDB.findRelatedProducts({
          category: product.category,
          _id: { $ne: id },
        });

      return {
        message: 'Product fetched successfully',
        result: { product, relatedProducts },
        success: true,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Updates a product by ID in the database and Stripe.
   * @async
   * @param {string} id - The ID of the product to update.
   * @param {CreateProductDto} updateProductDto - An object containing the updated product details.
   * @returns {Promise<{ message: string; result: Products; success: boolean }>} An object containing a message, the updated product document, and a success flag.
   * @throws {Error} If the product does not exist or an error occurs during the update process.
   */
  async updateProduct(
    id: string,
    updateProductDto: CreateProductDto,
  ): Promise<{ message: string; result: Products; success: boolean }> {
    try {
      const productExist = await this.productDB.findOne({ _id: id });
      if (!productExist) throw new Error('Product does not exist');

      const updateProduct = await this.productDB.findOneAndUpdate(
        { _id: id },
        updateProductDto,
      );
      if (!updateProductDto.stripeProductId) {
        await this.stripeClient.products.update(productExist.stripeProductId, {
          name: updateProductDto.productName,
          description: updateProductDto.description,
        });
      }

      return {
        message: 'Product updated successfully',
        result: updateProduct,
        success: true,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Removes a product by ID from the database and Stripe.
   * @async
   * @param {string} id - The ID of the product to remove.
   * @returns {Promise<{ message: string; success: boolean; result: null }>} An object containing a message, a success flag, and a null result.
   * @throws {Error} If the product does not exist or an error occurs during the deletion process.
   */
  async removeProduct(
    id: string,
  ): Promise<{ message: string; success: boolean; result: null }> {
    try {
      const productExist = await this.productDB.findOne({ _id: id });
      if (!productExist) throw new Error('Product does not exist');
      await this.productDB.findOneAndDelete({ _id: id });
      await this.stripeClient.products.del(productExist.stripeProductId);
      return {
        message: 'Product deleted successfully',
        success: true,
        result: null,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Uploads a product image to Cloudinary, updates the product document in the database and Stripe product data.
   * @async
   * @param {string} id - The ID of the product to update.
   * @param {any} file - The image file to upload.
   * @returns {Promise<{ message: string; success: boolean; result: string }>} - An object containing a message, a success flag and the URL of the uploaded image.
   * @throws {Error} - If the product does not exist or an error occurs during the upload process.
   */
  async uploadProductImage(
    id: string,
    file: any,
  ): Promise<{ message: string; success: boolean; result: string }> {
    try {
      const product = await this.productDB.findOne({ _id: id });
      if (!product) throw new Error('Product does not exist');
      if (product.imageDetails?.public_id) {
        await cloudinary.v2.uploader.destroy(product.imageDetails.public_id, {
          invalidate: true,
        });
      }

      const resOfCloudinary = await cloudinary.v2.uploader.upload(file.path, {
        folder: config.get('cloudinary.folderPath'),
        public_id: `${config.get('cloudinary.publicId_prefix')}${Date.now()}`,
        transformation: [
          {
            width: config.get('cloudinary.bigSize').toString().split('x')[0],
            height: config.get('cloudinary.bigSize').toString().split('x')[1],
            crop: 'fill',
          },
          { quality: 'auto' },
        ],
      });
      unlinkSync(file.path);
      await this.productDB.findOneAndUpdate(
        { _id: id },
        {
          imageDetails: resOfCloudinary,
          image: resOfCloudinary.secure_url,
        },
      );
      await this.stripeClient.products.update(product.stripeProductId, {
        images: [resOfCloudinary.secure_url],
      });

      return {
        message: 'Image uploaded successfully',
        success: true,
        result: resOfCloudinary.secure_url,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Updates the SKUs of a produt in the database and Stripe.
   * @async
   * @param {string} productId - The ID of the product to update.
   * @param {ProductSkuDtoArr} data - An object containing an array of SKU details.
   * @returns {Promise<{ message: string; success: boolean; result: string }>} - An object containing a message and a success flag.
   * @throws {Error} - If the product does not exist or an error occurs during the update process.
   */
  async updateProductSku(productId: string, data: ProductSkuDtoArr) {
    try {
      const product = await this.productDB.findOne({ _id: productId });
      if (!product) throw new Error('Product does not exist');

      const skuCode = Math.random().toString(36).substring(2, 5) + Date.now();
      for (let i = 0; i < data.skuDetails.length; i++) {
        if (!data.skuDetails[i].stripePriceId) {
          const stripePriceDetails = await this.stripeClient.prices.create({
            unit_amount: data.skuDetails[i].price * 100,
            currency: 'inr',
            product: product.stripeProductId,
            metadata: {
              skuCode,
              lifetime: data.skuDetails[i].lifetime + '',
              productId,
              price: data.skuDetails[i].price,
              productName: product.productName,
              productImage: product.image,
            },
          });
          data.skuDetails[i].stripePriceId = stripePriceDetails.id;
        }
        data.skuDetails[i].skuCode = skuCode;
      }

      await this.productDB.findOneAndUpdate(
        { _id: productId },
        { $push: { skuDetails: data.skuDetails } },
      );

      return {
        message: 'Product sku updated successfully',
        success: true,
        result: null,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Updates a product SKU by ID in the database and Stripe.
   * @async
   * @param productId - The ID of the product that the SKU belongs to.
   * @param skuId - The ID of the SKU to update.
   * @param data - An object containing the updated SKU details.
   * @returns {Promise<{ message: string; success: boolean; result: any }>} - An obect containing a message, a success flag and the updated product document.
   */
  async updateProductSkuById(
    productId: string,
    skuId: string,
    data: ProductSkuDto,
  ) {
    try {
      const product = await this.productDB.findOne({ _id: productId });
      if (!product) throw new Error('Product does not exist');

      const sku = product.skuDetails.find((sku) => sku._id == skuId);
      if (!sku) throw new Error('Sku does not exist');

      if (data.price !== sku.price) {
        const priceDetails = await this.stripeClient.prices.create({
          unit_amount: data.price * 100,
          currency: 'inr',
          product: product.stripeProductId,
          metadata: {
            skuCode: sku.skuCode,
            lifetime: data.lifetime + '',
            productId: productId,
            price: data.price,
            productName: product.productName,
            productImage: product.image,
          },
        });
        data.stripePriceId = priceDetails.id;
      }

      const dataForUpdate = {};
      for (const key in data) {
        if (data.hasOwnProperty(key)) {
          dataForUpdate[`skuDetails.$.${key}`] = data[key];
        }
      }

      const result = await this.productDB.findOneAndUpdate(
        {
          _id: productId,
          'skuDetails._id': skuId,
        },
        { $set: dataForUpdate },
      );

      return {
        message: 'Product sku updated successfully',
        success: true,
        result,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Deletes a product SKU by ID from the database and Stripe, and all the licenses associated with it.
   * @async
   * @param {string} id - The ID of the product that the SKU belongs to.
   * @param {string} skuId - The ID of the SKU to delete.
   * @returns {Promise<{ message: string; success: boolean; result: { id: string; skuId: string } }>} An object containing a message, a success flag, and the IDs of the deleted product and SKU.
   * @throws {Error} If the product or SKU does not exist or an error occurs during the deletion process.
   */
  async deleteProductSkuById(id: string, skuId: string) {
    try {
      const productDetails = await this.productDB.findOne({ _id: id });
      const skuDetails = productDetails.skuDetails.find(
        (sku) => sku._id.toString() === skuId,
      );
      await this.stripeClient.prices.update(skuDetails.stripePriceId, {
        active: false,
      });

      // delete the sku details from product
      await this.productDB.deleteSku(id, skuId);
      // delete all the licences from db for that sku
      await this.productDB.deleteAllLicense(undefined, skuId);

      return {
        message: 'Product sku details deleted successfully',
        success: true,
        result: {
          id,
          skuId,
        },
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Adds a license key to a product SKU in the database.
   * @async
   * @param {string} productId - The ID of the product that the SKU belongs to.
   * @param {string} skuId - The ID of the SKU to add the license to.
   * @param {string} licenseKey - The license key to add.
   * @returns {Promise<{ message: string; success: boolean; result: Licenses }>} An object containing a message, a success flag, and the created license document.
   * @throws {Error} If the product or SKU does not exist or an error occurs during the creation process.
   */
  async addProductSkuLicense(
    productId: string,
    skuId: string,
    licenseKey: string,
  ) {
    try {
      const product = await this.productDB.findOne({ _id: productId });
      if (!product) throw new Error('Product does not exist');

      const sku = product.skuDetails.find((sku) => sku._id == skuId);
      if (!sku) throw new Error('Sku does not exist');

      const result = await this.productDB.createLicense(
        productId,
        skuId,
        licenseKey,
      );

      return {
        message: 'License key added successfully',
        success: true,
        result,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Removes a license key from the database by ID.
   * @async
   * @param {string} id - The ID of the license to remove.
   * @returns {Promise<{ message: string; success: boolean; result: Licenses }>} An object containing a message, a success flag, and the deleted license document.
   * @throws {Error} If the license does not exist or an error occurs during the deletion process.
   */
  async removeProductSkuLicense(id: string) {
    try {
      const result = await this.productDB.removeLicense({ _id: id });
      return {
        message: 'License key removed successfully',
        success: true,
        result,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Finds all the licenses associated with a product SKU in the database.
   * @async
   * @param {string} productId - The ID of the product that the SKU belongs to.
   * @param {string} skuId - The ID of the SKU to find the licenses for.
   * @returns {Promise<{ message: string; success: boolean; result: Licenses[] }>} An object containing a message, a success flag, and an array of license documents.
   * @throws {Error} If the product or SKU does not exist or an error occurs during the search process.
   */
  async getProductSkuLicenses(productId: string, skuId: string) {
    try {
      const product = await this.productDB.findOne({ _id: productId });
      if (!product) {
        throw new Error('Product does not exist');
      }

      const sku = product.skuDetails.find((sku) => sku._id == skuId);
      if (!sku) {
        throw new Error('Sku does not exist');
      }

      const result = await this.productDB.findLicense({
        product: productId,
        productSku: skuId,
      });

      return {
        message: 'Licenses fetched successfully',
        success: true,
        result: result,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Updates a license key associated with a product SKU in the database.
   * @async
   * @param {string} productId - The ID of the product that the SKU belongs to.
   * @param {string} skuId - The ID of the SKU that the license belongs to.
   * @param {string} licenseKeyId - The ID of the license to update.
   * @param {string} licenseKey - The updated license key.
   * @returns {Promise<{ message: string; success: boolean; result: Licenses }>} An object containing a message, a success flag, and the updated license document.
   * @throws {Error} If the product, SKU, or license does not exist or an error occurs during the update process.
   */
  async updateProductSkuLicense(
    productId: string,
    skuId: string,
    licenseKeyId: string,
    licenseKey: string,
  ) {
    try {
      const product = await this.productDB.findOne({ _id: productId });
      if (!product) {
        throw new Error('Product does not exist');
      }

      const sku = product.skuDetails.find((sku) => sku._id == skuId);
      if (!sku) {
        throw new Error('Sku does not exist');
      }

      const result = await this.productDB.updateLicense(
        { _id: licenseKeyId },
        { licenseKey: licenseKey },
      );

      return {
        message: 'License key updated successfully',
        success: true,
        result: result,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Adds a review for a product in the database.
   * @async
   * @param {string} productId - The ID of the product to add the review for.
   * @param {number} rating - The rating to give the product.
   * @param {string} review - The written review of the product.
   * @param {Record<string, any>} user - The user object of the reviewer.
   * @returns {Promise<{ message: string; success: boolean; result: Product }>} An object containing a message, a success flag, and the updated product document.
   * @throws {Error} If the product does not exist, the user has already reviewed the product, or the user has not purchased the product.
   */
  async addProductReview(
    productId: string,
    rating: number,
    review: string,
    user: Record<string, any>,
  ) {
    try {
      const product = await this.productDB.findOne({ _id: productId });
      if (!product) {
        throw new Error('Product does not exist');
      }

      if (
        product.feedbackDetails.find(
          (value: { customerId: string }) =>
            value.customerId === user._id.toString(),
        )
      ) {
        throw new BadRequestException(
          'You have already gave the review for this product',
        );
      }

      const order = await this.orderDB.findOne({
        customerId: user._id,
        'orderedItems.productId': productId,
      });

      if (!order) {
        throw new BadRequestException('You have not purchased this product');
      }

      const ratings: any[] = [];
      product.feedbackDetails.forEach((comment: { rating: any }) =>
        ratings.push(comment.rating),
      );

      let avgRating = String(rating);
      if (ratings.length > 0) {
        avgRating = (ratings.reduce((a, b) => a + b) / ratings.length).toFixed(
          2,
        );
      }

      const reviewDetails = {
        rating: rating,
        feedbackMsg: review,
        customerId: user._id,
        customerName: user.name,
      };

      const result = await this.productDB.findOneAndUpdate(
        { _id: productId },
        { $set: { avgRating }, $push: { feedbackDetails: reviewDetails } },
      );

      return {
        message: 'Product review added successfully',
        success: true,
        result,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Removes a review for a product in the database.
   * @async
   * @param {string} productId - The ID of the product to remove the review from.
   * @param {string} reviewId - The ID of the review to remove.
   * @returns {Promise<{ message: string; success: boolean; result: Product }>} An object containing a message, a success flag, and the updated product document.
   * @throws {Error} If the product or review does not exist or an error occurs during the deletion process.
   */
  async removeProductReview(productId: string, reviewId: string) {
    try {
      const product = await this.productDB.findOne({ _id: productId });
      if (!product) {
        throw new Error('Product does not exist');
      }

      const review = product.feedbackDetails.find(
        (review) => review._id == reviewId,
      );
      if (!review) {
        throw new Error('Review does not exist');
      }

      const ratings: any[] = [];
      product.feedbackDetails.forEach((comment) => {
        if (comment._id.toString() !== reviewId) {
          ratings.push(comment.rating);
        }
      });

      let avgRating = '0';
      if (ratings.length > 0) {
        avgRating = (ratings.reduce((a, b) => a + b) / ratings.length).toFixed(
          2,
        );
      }

      const result = await this.productDB.findOneAndUpdate(
        { _id: productId },
        { $set: { avgRating }, $pull: { feedbackDetails: { _id: reviewId } } },
      );

      return {
        message: 'Product review removed successfully',
        success: true,
        result,
      };
    } catch (error) {
      throw error;
    }
  }
}
