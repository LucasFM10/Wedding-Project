migrate((app) => {
  const usersCollection = app.findCollectionByNameOrId("users");

  // 1. Criar Coleção 'casamentos'
  let casamentosCollection;
  try {
    casamentosCollection = app.findCollectionByNameOrId("casamentos");
  } catch (e) {
    casamentosCollection = new Collection({
      name: "casamentos",
      type: "base",
      listRule: "@request.auth.id != '' && (dono = @request.auth.id || membros ~ @request.auth.id)",
      viewRule: "@request.auth.id != '' && (dono = @request.auth.id || membros ~ @request.auth.id)",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != '' && (dono = @request.auth.id || membros ~ @request.auth.id)",
      deleteRule: "@request.auth.id != '' && dono = @request.auth.id"
    });

    casamentosCollection.fields.add(new TextField({
      name: "titulo",
      required: true
    }));

    casamentosCollection.fields.add(new DateField({
      name: "data_evento"
    }));

    casamentosCollection.fields.add(new RelationField({
      name: "dono",
      collectionId: usersCollection.id,
      maxSelect: 1,
      required: true
    }));

    casamentosCollection.fields.add(new RelationField({
      name: "membros",
      collectionId: usersCollection.id,
      maxSelect: 99
    }));

    app.save(casamentosCollection);
  }

  // 2. Criar Coleção 'convidados'
  let convidadosCollection;
  try {
    convidadosCollection = app.findCollectionByNameOrId("convidados");
  } catch (e) {
    convidadosCollection = new Collection({
      name: "convidados",
      type: "base",
      listRule: "@request.auth.id != '' && (casamento.dono = @request.auth.id || casamento.membros ~ @request.auth.id)",
      viewRule: "@request.auth.id != '' && (casamento.dono = @request.auth.id || casamento.membros ~ @request.auth.id)",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != '' && (casamento.dono = @request.auth.id || casamento.membros ~ @request.auth.id)",
      deleteRule: "@request.auth.id != '' && (casamento.dono = @request.auth.id || casamento.membros ~ @request.auth.id)"
    });

    convidadosCollection.fields.add(new RelationField({
      name: "casamento",
      collectionId: casamentosCollection.id,
      maxSelect: 1,
      required: true
    }));

    convidadosCollection.fields.add(new TextField({
      name: "nome",
      required: true
    }));

    convidadosCollection.fields.add(new TextField({
      name: "contato"
    }));

    convidadosCollection.fields.add(new EmailField({
      name: "email"
    }));

    convidadosCollection.fields.add(new SelectField({
      name: "confirmacao",
      values: ["Pendente", "Convite entregue", "Confirmado", "Não vai"],
      maxSelect: 1
    }));

    convidadosCollection.fields.add(new JSONField({
      name: "tags"
    }));

    convidadosCollection.fields.add(new BoolField({
      name: "is_acompanhante"
    }));

    convidadosCollection.fields.add(new JSONField({
      name: "custom_fields"
    }));

    // Salva a coleção primeiro para obter o ID gerado pelo PocketBase
    app.save(convidadosCollection);

    // Agora adiciona a auto-relação para 'convidado_principal'
    convidadosCollection.fields.add(new RelationField({
      name: "convidado_principal",
      collectionId: convidadosCollection.id,
      maxSelect: 1
    }));

    app.save(convidadosCollection);
  }

  // 3. Criar Casamento de Teste vinculado ao user@teste.com
  try {
    const userRecord = app.findAuthRecordByEmail("users", "user@teste.com");
    let casamentoRecord;

    try {
      casamentoRecord = app.findFirstRecordByFilter("casamentos", "dono = '" + userRecord.id + "'");
    } catch (e) {
      casamentoRecord = new Record(casamentosCollection);
      casamentoRecord.set("titulo", "Casamento de Lucas & Maria");
      casamentoRecord.set("dono", userRecord.id);
      app.save(casamentoRecord);
    }
  } catch (e) {}
}, (app) => {
  try {
    const convidados = app.findCollectionByNameOrId("convidados");
    app.delete(convidados);
  } catch (e) {}

  try {
    const casamentos = app.findCollectionByNameOrId("casamentos");
    app.delete(casamentos);
  } catch (e) {}
});
