const express = require('express');
const router = express.Router();
const mappingController = require('../controllers/accountMappingController');
const { protect } = require('../middleware/auth');

router.use(protect);

// CRUD
router.get('/', mappingController.listMappings);
router.get('/resolve', mappingController.resolve);
router.get('/:id', mappingController.getMapping);
router.post('/', mappingController.createMapping);
router.put('/:id', mappingController.updateMapping);
router.delete('/:id', mappingController.deleteMapping);

module.exports = router;
