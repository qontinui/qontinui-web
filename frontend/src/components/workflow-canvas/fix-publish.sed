/const template = await workflowTemplates.publishToMarketplace/,/});/ {
  s/name,//
  s/long_description:.*,//
  s/category_id:/categoryId:/
  s/license:.*,//
}
/await workflowTemplates.saveToMarketplaceDraft/,/});/ {
  s/name,//
  s/long_description:.*,//
  s/category_id:/categoryId:/
  s/license:.*,//
}
