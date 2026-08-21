import discord
from discord.ext import commands
import firebase_admin
from firebase_admin import credentials, db

# 1. Initialize Firebase Admin SDK
cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://YOUR-DATABASE-NAME.firebaseio.com/' # Replace with your actual Firebase DB URL
})

# 2. Setup Discord Bot Client
intents = discord.Intents.default()
intents.message_content = True
intents.members = True

bot = commands.Bot(command_prefix="!", intents=intents)

@bot.event
async def on_ready():
    print(f"Logged in as {bot.user.name}")

# 3. Verification Modal/Command
@bot.tree.command(name="verify", description="Verify your email address")
async def verify(interaction: discord.Interaction, email: str):
    # Acknowledge the interaction privately so nobody else sees the user's email
    await interaction.response.defer(ephemeral=True)
    
    formatted_email = email.strip().lower()

    # Search Firebase Database for matching user email
    ref = db.reference("users")
    users = ref.get()

    found_user_key = None
    if users:
        for user_key, user_data in users.items():
            if user_data.get("email", "").lower() == formatted_email:
                found_user_key = user_key
                break

    # DECLINED: Email not found in database
    if not found_user_key:
        await interaction.followup.send(
            "❌ Verification failed! That email is not registered in our database.", 
            ephemeral=True
        )
        return

    # CONFIRMED: Match found -> Update Firebase and assign Discord Role
    try:
        # Update user's record with their Discord ID
        ref.child(found_user_key).update({
            "discord_id": str(interaction.user.id),
            "is_verified": True
        })

        # Add "Verified" role in Discord server (replace "Verified" with your exact role name)
        guild = interaction.guild
        role = discord.utils.get(guild.roles, name="Verified")
        
        if role:
            await interaction.user.add_roles(role)
            role_msg = f" You were granted the **{role.name}** role!"
        else:
            role_msg = " (Note: 'Verified' role was not found in the server)."

        await interaction.followup.send(
            f"✅ **Success!** Email `{formatted_email}` verified.{role_msg}", 
            ephemeral=True
        )

    except Exception as e:
        print(f"Error during verification: {e}")
        await interaction.followup.send(
            "⚠️ An error occurred while processing your request. Contact an admin.", 
            ephemeral=True
        )

# Sync Slash Commands to Discord
@bot.event
async def setup_hook():
    await bot.tree.sync()

bot.run("YOUR_DISCORD_BOT_TOKEN")

