
<img width="1022" alt="Screenshot 2024-12-22 at 1 33 10 PM" src="https://github.com/user-attachments/assets/26c7becb-90fe-43e4-a9ea-7da6ca7f37d9" />

# What is this?

This is a Character Sheet for the Pathfinder 2e system on FoundryVTT. It was designed to be run on a phone or tablet during in-person games, replacing the need for a laptop. 
At this point, it's still probably more a proof of concept than something you'd want to depend on.

Unlike most of the mobile sheets out there, this applicaiton does not load Foundry in the background. Instead, it's a relatively light-weight webpage. 
All data exchange happens using Foundry's built-in websockets. This should make it run better on low-performace devices, and it should allow for a more customized, streamlined experience.

There are some limitations to this approach. Mainly, the character sheet doesn't work very well unless a GM is logged in. I'm looking to improve on this in the future, though there will always be limitations to what's possible.

## Things you can do now:
- View most character details, including stats, conditions, modifiers, inventory, and spell lists
- Read the full text of most items/feats/features/spells/etc., and send those items to chat
- Manage inventory, including changing locations and investment
- Change roll options and other sheet toggles
- Roll skill checks, cast spells, and make attacks, using a targeting proxy if desired (i.e., a horizontally mounted TV)
- Roll Pixel bluetooth dice and pass the results to the server
  
## Things on the top of my to-do list:
- Come up with a clever name (Tablemate was just the name of the private kitchen-sink module this evolved from)
- Provide a way to change modifiers before making rolls
- Continue improving UX, especially the sheet's responsiveness
- Some backend work, especially some data abstraction and better use of typing

## Things further down the list:
- A more intersting look, including support for theming
- Some way to browse items and add them to the character sheet
- More functionality when a GM is not available, and more graceful degredation for the things that aren't possible without a GM logged in

# How does it work?
Once the module is installed, GMs should see a setting menu that allows them to indicate which players will use the new Character Sheet. From then on, when those players login, they should be automatically routed to the sheet.

Manifest is here: https://github.com/this-gavagai/foundryvtt-tm/releases/latest/download/module.json

# A note of caution
I'm sharing this module in good faith. I use it in my own games, and I'm not aware of anything that would seriously mess up your game data. That said, I'm not particularly knowledgable as a programmer, and it's very possible I've done something stupid. Use at your own risk. Backups are good.

# Setup instructions
1) Install the module, login as GM, and activate it from the Manage Modules window.
2) Open up the module settings, click the "Select Character Sheet users" button, and select which users will use the character sheet mode instead of the usual foundry interface. (Note: this User must have "Owner" permissions set for at least one Actor in the world.)
3) From a different device or browser, navigate to the foundry login page (i.e., http://localhost:30000/) and sign in as the user chosen in step 2. The browser should begin to load the foundry client application but quickly re-route to the standalone webpage.
