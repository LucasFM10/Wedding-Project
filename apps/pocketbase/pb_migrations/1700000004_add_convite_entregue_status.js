migrate((app) => {
  try {
    const collection = app.findCollectionByNameOrId("convidados");
    const field = collection.fields.getByName("confirmacao");
    if (field) {
      field.values = ["Pendente", "Convite entregue", "Confirmado", "Não vai"];
      app.save(collection);
    }
  } catch (e) {
    console.error("Erro na migration 1700000004:", e);
  }
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("convidados");
    const field = collection.fields.getByName("confirmacao");
    if (field) {
      field.values = ["Pendente", "Confirmado", "Não vai"];
      app.save(collection);
    }
  } catch (e) {}
});
