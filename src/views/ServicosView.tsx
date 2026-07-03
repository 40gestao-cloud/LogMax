import React, { useState } from 'react';
import { FilialSelector, FilialOp } from '../components/FilialSelector';
import { GenericCRUDView } from './GenericCRUDView';

const FIELDS = [
  { key: 'codigo',  label: 'Código',       required: true, placeholder: 'Ex: SRV-001' },
  { key: 'nome',    label: 'Nome',          required: true, placeholder: 'Ex: Instalação' },
  { key: 'tipo',    label: 'Tipo',          placeholder: 'Ex: Manutenção' },
  { key: 'valor',   label: 'Valor (R$)',    type: 'currency' as const, placeholder: '0,00' },
  { key: 'status',  label: 'Status',        type: 'select' as const, options: ['Ativo', 'Inativo'] },
];

export const ServicosView = ({ showToast }: { showToast: any }) => {
  const [filial, setFilial] = useState<FilialOp | null>(null);

  if (!filial) return (
    <FilialSelector
      title="Serviços"
      subtitle="Selecione a unidade para gerenciar serviços prestados."
      onSelect={setFilial}
    />
  );

  return (
    <GenericCRUDView
      showToast={showToast}
      title={`Serviços — ${filial}`}
      subtitle="Gerencie os serviços prestados."
      endpoint="/api/servicosview"
      fields={FIELDS}
      filialLocked={filial}
      onTrocarFilial={() => setFilial(null)}
    />
  );
};
