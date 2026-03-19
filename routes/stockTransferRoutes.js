const express = require('express');
const router = express.Router();
const stockTransferController = require('../controllers/stockTransferController');

router.post('/', stockTransferController.create);
router.put('/:id', stockTransferController.update);
router.post('/:id/confirm', stockTransferController.confirm);
router.post('/:id/cancel', stockTransferController.cancel);
router.get('/', stockTransferController.list);
router.get('/:id', stockTransferController.get);

module.exports = router;
