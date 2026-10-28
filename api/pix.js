import { createPaymentService } from '../lib/payments.js';
import { nodeHandler } from '../lib/node-adapter.js';
export default nodeHandler(request => createPaymentService().create(request));
