import { useTr } from './Impact';
export default function Legal() {
  const tr = useTr(); const Tbd = () => <span className="badge bg-wheat/40 ml-1">{tr('à compléter', 'to be completed')}</span>;
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-3"><h1 className="text-3xl">{tr('Mentions légales et confidentialité', 'Legal notice and privacy')}</h1>
      <p className="text-sm"><span className="badge bg-wheat/40">{tr('Texte provisoire, à faire valider par Carbone Farmers et son conseil juridique avant mise en ligne', 'Provisional text, to be validated by Carbone Farmers and its legal counsel before launch')}</span></p>
      <h2 className="text-xl mt-4">{tr('Éditeur', 'Publisher')}</h2><p>Carbone Farmers. {tr('Forme juridique, adresse, directeur de la publication, hébergeur', 'Legal form, address, publication director, host')}<Tbd /></p>
      <h2 className="text-xl mt-4">{tr('Données personnelles', 'Personal data')}</h2>
      <ul className="list-disc pl-5 space-y-1 text-sm"><li>{tr('Le site public ne contient aucun outil de mesure d’audience ni de publicité.', 'The public site contains no analytics or advertising tools.')}</li><li>{tr('Un cookie de session n’est créé que si vous vous connectez à un espace (financeur, porteur de projet, administration). Votre langue préférée est mémorisée dans votre navigateur.', 'A session cookie is created only if you sign in to an area (funder, project owner, administration). Your preferred language is remembered in your browser.')}</li><li>{tr('Les fonds de carte sont fournis par OpenStreetMap : votre navigateur contacte ce service pour les afficher.', 'Map tiles are provided by OpenStreetMap: your browser contacts that service to display them.')}</li><li>{tr('Les données des exploitations agricoles : positions floutées, nom publié seulement avec l’accord de l’agriculteur ; adresses, numéros d’entreprise, téléphones et paiements jamais publiés.', 'Farm data: blurred positions, name published only with the farmer’s consent; addresses, company numbers, phones and payments never published.')}</li></ul>
      <p className="text-sm">{tr('Exercice de vos droits (accès, rectification, suppression), durée de conservation, responsable du traitement et délégué à la protection des données', 'Exercising your rights (access, rectification, deletion), retention period, data controller and data protection officer')}<Tbd /></p>
    </div>
  );
}
