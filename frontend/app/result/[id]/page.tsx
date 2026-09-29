'use client';

import { useParams } from 'next/navigation';
import PrescriptionWorkspace from '@/components/PrescriptionWorkspace';

export default function ResultPage() {
  const params = useParams();
  const taskId = params?.id ? (Array.isArray(params.id) ? params.id[0] : params.id) : undefined;

  return <PrescriptionWorkspace initialTaskId={taskId} />;
}
