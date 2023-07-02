const User = require('../models/user')
const ProjectRole = require('../models/projectRole')
const Project = require('../models/project')
const Team = require('../models/team')

/**
 * Checks if the user is a member of the project
 * @method checkMember
 * @description used to check if the user making the request is a member of the project before excecuting the next function in the route's callbacks
 * @throws throws an error if the user is not a member of the project
 */
exports.checkMember = async (req, res, next) => {
    try {
        const project = await Project.findOne({ _id: req.params.id })
        if(!project.members.includes(req.user._id)) {
            throw new Error(`user is not a member of ${project.title}`)
        }
        next()
    } catch (error) {
        res.status(400).json({message: error.message })
    }
}

/**
 * Checks if the user is an admin for the project
 * @method checkAdmin
 * @description used to check if the user making the request is an admin of the project before excecuting the next function in the route's callbacks
 * @throws throws an error if the user is not a member of the project
 */
exports.checkAdmin = async (req, res, next) => {
    try {
        const userRole = await ProjectRole.findOne({ user: req.user._id, project: req.params.id })
        if(userRole.role !== 'admin') {
            throw new Error('user not authorized')
        }
        next()
    } catch (error) {
        res.status(400).json({ message: error.message })
    }
}

/**
 * Create a new project
 * @method createProject
 * @description creates a new project
 * 
 * Request will contain: 
 *  - title: (required) title of the project
 *  - description: description of the project
 *  - type: (required) type of project  
 *      -- can be 'personal' or 'team'
 *  - startDate: start date of the project  
 *      -- defaults to Date.now
 *  - endDate: (required) end date of the project
 *  - team: ObjectId of the team the project is assigned to (only if project type is 'team')
 * 
 * The user will automatically be assigned to an admin role for the project created
 */
exports.createProject= async (req, res) => {
    try {
        // create project
        const project = await Project.create(req.body)
        // assign admin role to user who created the project + add to user's projects array
        const projectRole = await ProjectRole.create({ user: req.user._id, role: 'admin', project: project._id })
        req.user.projects.addToSet({ _id: projectRole._id })
        await req.user.save()
        // add user to project's members array
        project.members.addToSet({ _id: req.user._id })
        await project.save()
        if (project.type === 'team') {
            const team = await Team.findOne({ _id: req.body.team })
            team.projects.addToSet({ _id: project._id })
            await team.save()
        }
        res.json({ project, projectRole, user: req.user})
    } catch (error) {
        res.status(400).json({ message: error.message })
    }
}

/**
 * Add a member to a project
 * @method addProjectMember
 * @description adds a member to the project specified by req.params.id
 * 
 * Request will contain: 
 *  - member: (required) ObjectId of the user being added as a member to the project
 *  - role: (required) desired role for the new member  
 *      -- can either be 'admin' or 'contributor'
 */
exports.addProjectMember = async (req, res) => {
    try {
        // find project using req.params.id
        const project = await Project.findOne({ _id: req.params.id })
        // find user by _id
        const member = await User.findOne({ _id: req.body._id })
        project.members.addToSet({ _id: member._id})
        await project.save()
        // create role for new member
        const memberRole = await ProjectRole.create({ user: member._id, role: req.body.role, project: project._id })
        // add role to new member's projects array
        member.projects.addToSet({ _id: memberRole._id })
        await member.save()
        res.json({ project, memberRole, member })
    } catch (error) {
        res.status(400).json({ message: error.message })
    }
}


/**
 * Remove a member from a project
 * @method removeProjectMember
 * @description removes a member from the project specified by req.params.id
 * 
 * Request will contain: 
 *  - member: (required) ObjectId of the user being added as a member to the project
 */
exports.removeProjectMember = async (req, res) => {
    try {
        // find project using req.params.id
        const project = await Project.findOne({ _id: req.params.id })
        // find member by _id
        const member = await User.findOne({ _id: req.body._id })
        // remove member from project's members array
        project.members.splice(project.members.indexOf(member._id), 1)
        await project.save()
        // delete member's projectRole for project
        const memberRole = await ProjectRole.findOneAndDelete({ user: member._id, project: project._id })
        // remove deleted role from member's projects array
        member.projects.splice(member.projects.indexOf(memberRole._id), 1)
        member.save()
        res.json({ project, member })
    } catch (error) {
        res.status(400).json({ message: error.message })
    }
}

/**
 * Update project details
 * @method updateProject
 * @description updates information of the project specified by req.params.id
 * 
 * Request may contain: 
 *  - title: title of the project
 *  - description: description of the project
 *  - startDate: start date of the project
 *  - endDate: end date of the project
 */
exports.updateProject = async (req, res) => {
    try {
        // find project using req.params.id
        const project = await Project.findOne({ _id: req.params.id })
        // make requested updates to project information
        const updates = Object.keys(req.body)
        updates.forEach(update => project[update] = req.body[update])
        await project.save()
        res.json(project)
    } catch (error) {
        res.status(400).json({ message: error.message })
    }
}

/**
 * Delete project
 * @method deleteProject
 * @description deletes the project specified by req.params.id
 * 
 * Also removes the project reference from any teams or users it was assigned to and deleted associated projectRoles
 */
exports.deleteProject = async (req, res) => {
    try {
        // find project using req.params.id
        const project = await Project.findOneAndDelete({ _id: req.params.id })
        // if project is a team project, remove from team's projects array
        if(project.type === 'team') {
            const team = await Team.findOne({ _id: project.team })
            team.projects.splice(team.projects.indexOf(project._id), 1)
            team.save()
        }
        // find all project roles associated with the project
        const projectRoles = await ProjectRoles.find({ project: project._id })
        // remove associated project role from each member's projects array
        projectRoles.forEach(async (role) => {
            const member = await User.find({ _id: role.user })
            member.projects.splice(member.projects.indexOf(role._id), 1)
            await member.save()
        })
        // delete project roles
        projectRoles.deleteMany()

        res.json({ message: `${project.title} deleted` })
    } catch (error) {
        res.status(400).json({ message: error.message })
    }
}

/**
 * Show a project
 * @method showProject
 * @description shows the project specified by req.params.id and populates associated task data
 */
exports.showProject = async (req, res) => {
    try {
        // find project using req.params.id
        const project = await Project.findOne({ _id: req.params.id })
        // populate task details
            .populate('tasks', 'title dueDate assignedTo status')
            .exec()
        // populate name of person task is assigned to 
        project.tasks.populate('assignedTo', 'firstName lastName fullName')
        res.json(project)
    } catch (error) {
        res.status(400).json({ message: error.message })
    }
}

/**
 * Show all personal projects
 * @method showAllPersonalProjects
 * @description shows all of a user's personal projects and populates associated task data
 */
exports.showPersonalProjects = async (req, res) => {
    try {
        // find all personal projects where user is a member
        const projects = await Project.find({ members: { contains: req.user.id }, type: 'personal' })
        // populate task details
        .populate('tasks', 'title dueDate assignedTo status')
        .exec()
        res.json({projects})
    } catch (error) {
        res.status(400).json({ message: error.message })
    }
}

// 🟥 METHOD FOR CHANGING A MEMBER'S ROLE?? 🟥