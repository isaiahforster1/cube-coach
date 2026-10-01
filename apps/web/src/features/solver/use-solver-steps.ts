import { useQuery } from '@tanstack/react-query';
import {
  formatAlgorithm,
  type Face,
  type Move,
  type SolverStepsResponse,
} from '@cube-coach/shared';
import { api } from '../../lib/api-client.js';

export interface SolverRequest {
  readonly scramble: readonly Move[];
  readonly crossFace: Face;
}

/**
 * The solver's steps for a scramble, from the API.
 *
 * The solver is in the shared package and could run here, as the scramble rating does.
 * It runs on the server because the explanation will be written there: the model needs
 * a key the browser must never hold, and the notation gate has to run where the model's
 * text arrives, before anything is shown.
 *
 * Cached for the session (ADR-0022 §5). A model's wording can differ between calls, but
 * the text should not change while someone is reading it, and fetching again would spend
 * the model's quota for nothing. The cost: if the first answer fell back to the template,
 * this tab keeps the template until it is reloaded.
 */
export function useSolverSteps(request: SolverRequest | null) {
  const scramble = request === null ? '' : formatAlgorithm(request.scramble);
  const crossFace = request?.crossFace ?? 'D';

  return useQuery({
    queryKey: ['solver-steps', scramble, crossFace],
    queryFn: () => {
      const query = new URLSearchParams({ scramble, crossFace });
      return api.get<SolverStepsResponse>(`/solver/steps?${query.toString()}`);
    },
    enabled: request !== null,
    staleTime: Infinity,
  });
}
